import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "Bridge AI <noreply@bridge-jobs.com>";

/**
 * Sends a candidate invite email with a link to the take-home assessment.
 */
export async function sendCandidateInvite(
  to: string,
  candidateName: string,
  assessmentTitle: string,
  shareLink: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Technical Assessment from Bridge AI</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f4f4f5;
      margin: 0;
      padding: 0;
      color: #18181b;
    }
    .wrapper {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .header {
      background-color: #18181b;
      padding: 32px 40px;
    }
    .header h1 {
      color: #ffffff;
      font-size: 20px;
      font-weight: 600;
      margin: 0;
      letter-spacing: -0.02em;
    }
    .body {
      padding: 40px;
    }
    .body p {
      font-size: 15px;
      line-height: 1.6;
      color: #3f3f46;
      margin: 0 0 16px;
    }
    .assessment-title {
      background-color: #f4f4f5;
      border-left: 3px solid #18181b;
      padding: 12px 16px;
      margin: 24px 0;
      border-radius: 0 4px 4px 0;
      font-size: 15px;
      font-weight: 600;
      color: #18181b;
    }
    .cta {
      text-align: center;
      margin: 32px 0;
    }
    .cta a {
      display: inline-block;
      background-color: #18181b;
      color: #ffffff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .footer {
      padding: 24px 40px;
      border-top: 1px solid #e4e4e7;
      font-size: 13px;
      color: #71717a;
      line-height: 1.5;
    }
    .footer a {
      color: #71717a;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Bridge AI</h1>
    </div>
    <div class="body">
      <p>Hi ${candidateName},</p>
      <p>
        You have been invited to complete a take-home technical assessment. Please find the details below.
      </p>
      <div class="assessment-title">${assessmentTitle}</div>
      <p>
        Click the button below to access your assessment. Make sure you have enough uninterrupted time before you begin, as the timer will start once you open the assessment.
      </p>
      <div class="cta">
        <a href="${shareLink}">Start Assessment</a>
      </div>
      <p>
        If the button above does not work, copy and paste the following link into your browser:
      </p>
      <p><a href="${shareLink}">${shareLink}</a></p>
    </div>
    <div class="footer">
      <p>
        This invitation was sent by Bridge AI on behalf of the employer. If you were not expecting this email, you can safely ignore it.
      </p>
    </div>
  </div>
</body>
</html>
    `.trim();

    await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: "Your technical assessment from Bridge AI",
      html,
    });

    return { success: true };
  } catch (err: unknown) {
    const error =
      err instanceof Error ? err.message : "Failed to send email";
    return { success: false, error };
  }
}
