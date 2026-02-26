/**
 * BCH Payment Requests Client
 * 
 * Merchant payment system for Bitcoin Cash.
 * Supports payment requests, QR codes, and webhooks.
 */

export interface PaymentRequest {
    requestId: string;
    address: string;
    amountSats: number;
    amountBch: number;
    description: string;
    status: "pending" | "paid" | "expired";
    createdAt: number;
    expiresAt: number;
    paidAt?: number;
    paidTxid?: string;
}

export interface PaymentConfig {
    restUrl: string;
    network?: string;
}

/**
 * Generate a unique payment request ID
 */
function generateRequestId(): string {
    return `pay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generate a payment address (for demo, uses a derived address)
 */
function generatePaymentAddress(seed: string, network: string): string {
    // In production, generate a fresh address per payment request
    const hash = Buffer.from(seed).toString("hex").slice(0, 40);
    const prefix = network === "mainnet" ? "bitcoincash" : "bchtest";
    return `${prefix}:q${hash.slice(0, 38)}`;
}

/**
 * Generate QR code data for payment
 */
function generatePaymentQR(address: string, amountSats: number): string {
    // BCH payment URI format: bitcoin cash:<address>?amount=<sats>
    const uri = `bitcoin-cash:${address}?amount=${amountSats / 1e8}`;
    return uri;
}

/**
 * Parse payment URI
 */
function parsePaymentURI(uri: string): { address: string; amountSats?: number } | null {
    try {
        // bitcoin-cash:q... ?amount=...
        const match = uri.match(/^bitcoin-cash:([a-z0-9:]+)(?:\?amount=([0-9.]+))?$/i);
        if (!match) return null;

        const address = match[1];
        const amountBch = match[2] ? parseFloat(match[2]) : undefined;
        const amountSats = amountBch ? Math.round(amountBch * 1e8) : undefined;

        return { address, amountSats };
    } catch {
        return null;
    }
}

export class BchPaymentsClient {
    private restUrl: string;
    private network: string;
    private requests: Map<string, PaymentRequest> = new Map();

    constructor(config: PaymentConfig) {
        this.restUrl = config.restUrl.replace(/\/+$/, "");
        this.network = config.network ?? "chipnet";
    }

    /**
     * Create a new payment request
     */
    async createPaymentRequest(params: {
        amountSats: number;
        description: string;
        expiryMinutes?: number;
        receiveAddress?: string;
    }): Promise<PaymentRequest> {
        const { amountSats, description, expiryMinutes = 60, receiveAddress } = params;

        const requestId = generateRequestId();
        const address = receiveAddress || generatePaymentAddress(requestId, this.network);
        const now = Date.now();

        const request: PaymentRequest = {
            requestId,
            address,
            amountSats,
            amountBch: amountSats / 1e8,
            description,
            status: "pending",
            createdAt: now,
            expiresAt: now + (expiryMinutes * 60 * 1000)
        };

        this.requests.set(requestId, request);

        console.log(`[bch-payments] Created payment request:`);
        console.log(`  - ID: ${requestId}`);
        console.log(`  - Address: ${address}`);
        console.log(`  - Amount: ${request.amountBch} BCH (${amountSats} sats)`);
        console.log(`  - Expires: ${new Date(request.expiresAt).toISOString()}`);

        return request;
    }

    /**
     * Check if payment has been received
     */
    async checkPayment(requestId: string): Promise<PaymentRequest | null> {
        const request = this.requests.get(requestId);
        if (!request) return null;

        // Check if expired
        if (Date.now() > request.expiresAt && request.status === "pending") {
            request.status = "expired";
            return request;
        }

        try {
            // Check blockchain for incoming payments
            const url = `${this.restUrl}/electrumx/balance/${request.address}`;
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json() as any;
                const confirmed = data?.balance?.confirmed ?? 0;

                if (confirmed >= request.amountSats) {
                    request.status = "paid";
                    request.paidAt = Date.now();
                    request.paidTxid = `paid_${Date.now()}`; // Would fetch actual txid
                }
            }
        } catch (e) {
            console.error("[bch-payments] Check payment error:", (e as Error).message);
        }

        return request;
    }

    /**
     * Generate payment QR code (returns URI for QR generation)
     */
    generateQR(requestId: string): string | null {
        const request = this.requests.get(requestId);
        if (!request) return null;

        return generatePaymentQR(request.address, request.amountSats);
    }

    /**
     * Generate payment link (for web payments)
     */
    generatePaymentLink(requestId: string): string | null {
        const request = this.requests.get(requestId);
        if (!request) return null;

        // Generate a payment link that can be opened in wallet apps
        return generatePaymentQR(request.address, request.amountSats);
    }

    /**
     * Get payment request details
     */
    getPaymentRequest(requestId: string): PaymentRequest | null {
        return this.requests.get(requestId) || null;
    }

    /**
     * List all payment requests
     */
    listPaymentRequests(): PaymentRequest[] {
        return Array.from(this.requests.values()).sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * Cancel a payment request
     */
    cancelPaymentRequest(requestId: string): boolean {
        const request = this.requests.get(requestId);
        if (!request) return false;

        if (request.status === "paid") {
            return false; // Cannot cancel paid request
        }

        request.status = "expired";
        return true;
    }

    /**
     * Webhook handler for payment notifications
     * 
     * Call this when a webhook is received from the payment processor
     */
    async handleWebhook(payload: {
        txid: string;
        address: string;
        amountSats: number;
    }): Promise<PaymentRequest | null> {
        // Find payment request by address
        const request = Array.from(this.requests.values())
            .find(r => r.address === payload.address && r.status === "pending");

        if (!request) return null;

        // Verify amount
        if (payload.amountSats >= request.amountSats) {
            request.status = "paid";
            request.paidAt = Date.now();
            request.paidTxid = payload.txid;

            console.log(`[bch-payments] Payment received for request ${request.requestId}`);
            console.log(`  - TXID: ${payload.txid}`);
            console.log(`  - Amount: ${payload.amountSats} sats`);
        }

        return request;
    }
}

/**
 * Generate payment URI for manual payments
 */
export function createPaymentURI(address: string, amountBch?: number, message?: string): string {
    let uri = `bitcoin-cash:${address}`;

    const params = new URLSearchParams();
    if (amountBch !== undefined && amountBch > 0) {
        params.set("amount", amountBch.toString());
    }
    if (message) {
        params.set("message", message);
    }

    const paramString = params.toString();
    if (paramString) {
        uri += "?" + paramString;
    }

    return uri;
}

/**
 * Parse payment URI
 */
export function parsePaymentRequestURI(uri: string): { address: string; amount?: number; message?: string } | null {
    const parsed = parsePaymentURI(uri);
    if (!parsed) return null;

    return {
        address: parsed.address,
        amount: parsed.amountSats ? parsed.amountSats / 1e8 : undefined
    };
}

/**
 * Invoice status
 */
export type InvoiceStatus = "pending" | "processing" | "paid" | "expired" | "cancelled";

/**
 * Generate a shareable invoice link
 */
export function generateInvoiceLink(baseUrl: string, invoiceId: string): string {
    return `${baseUrl}/invoice/${invoiceId}`;
}
