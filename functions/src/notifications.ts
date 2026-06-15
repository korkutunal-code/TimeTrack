import * as functions from 'firebase-functions';
import twilio from 'twilio';
import * as nodemailer from 'nodemailer';

export class NotificationService {
    private twilioClient: twilio.Twilio | null = null;
    private twilioPhone: string | null = null;
    // Fallback to simple Gmail setup since specific existing SMTP wasn't explicitly provided,
    // or it will use environment variables if provided.
    private transporter: nodemailer.Transporter | null = null;

    constructor() {
        this.initTwilio();
        this.initEmail();
    }

    private initTwilio() {
        // Read from environment variables
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

        if (accountSid && authToken && phoneNumber) {
            try {
                this.twilioClient = twilio(accountSid, authToken);
                this.twilioPhone = phoneNumber;
            } catch (err) {
                functions.logger.error("Failed to initialize Twilio client:", err);
                this.twilioClient = null;
            }
        } else {
            functions.logger.info("SMS disabled – Twilio not configured (Missing SID, Token, or Phone Number in ENV)");
        }
    }

    private initEmail() {
        // Use env variables for SMTP or default to a dummy for now until configured
        const user = process.env.SMTP_USER || '';
        const pass = process.env.SMTP_PASS || '';
        const host = process.env.SMTP_HOST || 'smtp.gmail.com'; // Defaulting host for convenience
        const port = parseInt(process.env.SMTP_PORT || '465', 10);

        if (user && pass) {
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465, // true for 465, false for other ports
                auth: {
                    user,
                    pass,
                },
            });
        } else {
            functions.logger.warn("Email service not fully configured - Missing SMTP_USER or SMTP_PASS.");
        }
    }

    /**
     * Safely attempts to send an SMS.
     * If Twilio is not configured, logs cleanly and resolves without errors.
     */
    async sendSMS(phoneNumber: string, message: string): Promise<boolean> {
        if (!this.twilioClient || !this.twilioPhone) {
            functions.logger.info(`Skipped SMS to ${phoneNumber} - Twilio not configured.`);
            return false; // Not sent
        }

        try {
            const response = await this.twilioClient.messages.create({
                body: message,
                from: this.twilioPhone,
                to: phoneNumber
            });
            functions.logger.info(`SMS sent successfully to ${phoneNumber}. SID: ${response.sid}`);
            return true;
        } catch (error) {
            // Catch all errors (e.g., invalid phone format, out of funds) safely.
            functions.logger.error(`Failed to send SMS to ${phoneNumber}:`, error);
            return false;
        }
    }

    /**
     * Safely attempts to send an Email.
     */
    async sendEmail(to: string, subject: string, bodyText: string): Promise<boolean> {
        if (!this.transporter) {
            functions.logger.warn(`Skipped Email to ${to} - SMTP not configured.`);
            return false;
        }

        try {
            const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@americantiledepot.com';
            await this.transporter.sendMail({
                from: `"Time Tracker" <${fromEmail}>`,
                to,
                subject,
                text: bodyText,
                // We use text to keep it purely informative, clean, and not dependent on complex HTML.
            });

            functions.logger.info(`Email sent successfully to ${to} re: "${subject}"`);
            return true;
        } catch (error) {
            functions.logger.error(`Failed to send email to ${to}:`, error);
            return false;
        }
    }
}

export const notificationService = new NotificationService();
