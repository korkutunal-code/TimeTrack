"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = exports.NotificationService = void 0;
const functions = __importStar(require("firebase-functions"));
const twilio_1 = __importDefault(require("twilio"));
const nodemailer = __importStar(require("nodemailer"));
class NotificationService {
    constructor() {
        this.twilioClient = null;
        this.twilioPhone = null;
        // Fallback to simple Gmail setup since specific existing SMTP wasn't explicitly provided,
        // or it will use environment variables if provided.
        this.transporter = null;
        this.initTwilio();
        this.initEmail();
    }
    initTwilio() {
        // Read from environment variables
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
        if (accountSid && authToken && phoneNumber) {
            try {
                this.twilioClient = (0, twilio_1.default)(accountSid, authToken);
                this.twilioPhone = phoneNumber;
            }
            catch (err) {
                functions.logger.error("Failed to initialize Twilio client:", err);
                this.twilioClient = null;
            }
        }
        else {
            functions.logger.info("SMS disabled – Twilio not configured (Missing SID, Token, or Phone Number in ENV)");
        }
    }
    initEmail() {
        // Use env variables for SMTP or default to a dummy for now until configured
        const user = process.env.SMTP_USER || '';
        const pass = process.env.SMTP_PASS || '';
        const host = process.env.SMTP_HOST || 'smtp.gmail.com'; // Defaulting host for convenience
        const port = parseInt(process.env.SMTP_PORT || '465', 10);
        if (user && pass) {
            this.transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                auth: {
                    user,
                    pass,
                },
            });
        }
        else {
            functions.logger.warn("Email service not fully configured - Missing SMTP_USER or SMTP_PASS.");
        }
    }
    /**
     * Safely attempts to send an SMS.
     * If Twilio is not configured, logs cleanly and resolves without errors.
     */
    async sendSMS(phoneNumber, message) {
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
        }
        catch (error) {
            // Catch all errors (e.g., invalid phone format, out of funds) safely.
            functions.logger.error(`Failed to send SMS to ${phoneNumber}:`, error);
            return false;
        }
    }
    /**
     * Safely attempts to send an Email.
     */
    async sendEmail(to, subject, bodyText) {
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
        }
        catch (error) {
            functions.logger.error(`Failed to send email to ${to}:`, error);
            return false;
        }
    }
}
exports.NotificationService = NotificationService;
exports.notificationService = new NotificationService();
//# sourceMappingURL=notifications.js.map