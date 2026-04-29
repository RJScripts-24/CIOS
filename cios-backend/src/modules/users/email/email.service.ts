import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {
    this.resend = new Resend(this.configService.getOrThrow('RESEND_API_KEY'));
  }

  async sendInvite(params: {
    to: string;
    inviterName: string;
    magicLink: string;
  }): Promise<void> {
    const { to, inviterName, magicLink } = params;

    try {
      await this.resend.emails.send({
        from: this.configService.getOrThrow('EMAIL_FROM'),
        to,
        subject: `You've been invited to join CIOS`,
        html: `
          <p>Hi,</p>
          <p>${inviterName} has invited you to join your team's CIOS workspace.</p>
          <p>Click the link below to set your password and get started:</p>
          <p><a href="${magicLink}">${magicLink}</a></p>
          <p>This link does not expire. If you did not expect this invitation, you can safely ignore this email.</p>
        `,
      });
    } catch (error) {
      this.logger.error(`Failed to send invite email to ${to}`, error as Error);
    }
  }
}