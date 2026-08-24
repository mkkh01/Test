# Email provider comparison

## Resend

Resend's official documentation says sending should use a domain owned by the sender and that a domain must be added and verified before normal sending. The shared `onboarding@resend.dev` address is suitable for limited testing, not for building a sending reputation for customer outreach. Official documentation: https://resend.com/docs/dashboard/domains/introduction

## Brevo

Brevo's official free-plan FAQ says the free plan is not time-limited and includes 300 email sends per day, but it includes Brevo branding and has feature limits. Brevo still requires proper sender/domain authentication for reliable production sending; a free quota does not guarantee inbox placement. Official documentation: https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan

## MailerSend

MailerSend's official pricing page lists a free plan with 500 emails per month and a trial domain for testing. The same page says the trial plan is limited and that the free plan requires account approval and billing information. The trial domain is a testing convenience, not a guarantee that commercial outreach will reach the inbox. Official page: https://www.mailersend.com/pricing

## Amazon SES

AWS says SES requires verification of the From/Sender/Return-Path identity, and that accounts in the SES sandbox must also verify recipient email addresses. SES is inexpensive, but it is not a free-domain solution and requires additional AWS setup and production-access approval. Official documentation: https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html

## Practical conclusion

No provider can guarantee inbox placement. The main factors are an owned and authenticated domain, sender reputation, permission-based sending, low complaint and bounce rates, relevant content, correct Reply-To, and suppression of opt-outs and bounced addresses. A free sending quota or trial domain does not replace domain ownership or recipient consent.
