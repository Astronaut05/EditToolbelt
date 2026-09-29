# 08 — Legal and privacy

> Not legal advice. This doc turns known requirements into build rules. Before taking the first payment, have a lawyer review the Privacy Policy, Terms, and the items in "Needs a lawyer" at the bottom.

## Design choices that make compliance easy

Most legal risk on sites like this comes from tracking, keeping files, and vague money terms. We avoid all three by design:

1. **Minimal data.** The only personal data we hold: email, (optional) display name, purchase records, job metadata, session cookies. IP-based rate limiting happens at Cloudflare's edge; the app stores no IPs, hashed or raw. No names, addresses or card data (Paddle holds billing details as merchant of record).
2. **Browser processing by default.** For client tools, files never reach us at all. Say this on every such page.
3. **Short retention for server files.** Inputs deleted on job end, outputs within 1 hour; a storage-level backstop removes anything the sweeper missed within 48 hours (see `01-architecture.md`). Publicly promise "deleted within 1 hour" and describe the 48 h backstop in the Privacy page — don't claim a 24 h ceiling the storage provider doesn't guarantee.
4. **No tracking cookies, no ads, no third-party pixels.** Only strictly necessary cookies → no consent banner is needed for them in the EU/UK. Analytics are cookieless and aggregate.
5. **No training on user files.** State it plainly.

If any of these change (e.g. adding an ad pixel or marketing analytics), a consent banner with "Reject all" as prominent as "Accept all", blocking scripts until consent, becomes mandatory — treat it as a new milestone, not a quick add.

## Pages to ship (milestone 1 stubs, final text before launch)

| Page | Must contain |
|---|---|
| `/privacy` | Who we are and contact; what data, why, legal basis (table below); processors and where they are; retention (table below); international transfers; rights and how to use them (self-serve export/delete + email); cookies list; children; changes; effective date. Plain English, short sections. |
| `/terms` | Service description; accounts; acceptable use (see below); user content: you keep all rights, you confirm you have the rights to what you upload, we process it only to deliver the result, no training; credits: what they are, non-transferable, no cash value, don't expire, refund policy; availability "as is", liability limits; termination; governing law; contact. |
| `/refunds` | The credit refund policy from `05` in plain words. |
| `/cookies` | Table of every cookie/storage item with purpose and lifetime (can be a section of Privacy). |
| `/licenses` | Open-source attributions and model licenses (generated from the license register, `13-licenses.md`). Required by MIT/BSD/Apache notice clauses. |
| `/contact` | Email; abuse reports; privacy requests. |

Footer links to all of these on every page. Checkout shows links to Terms and Refunds next to the pay button.

## Legal bases and retention

| Data | Purpose | Basis (GDPR) | Retention |
|---|---|---|---|
| Email, account | Provide account, sign-in, receipts link | Contract | Until deletion + 30-day grace |
| Purchase records | Credits, accounting, refunds | Contract; legal obligation | As required for accounting (anonymised from email after account deletion) |
| Credit ledger | Balance integrity | Contract | Life of account; anonymised after deletion |
| Job metadata (no content) | Deliver service, fix failures, pricing | Contract; legitimate interest | 90 days, then aggregated |
| Uploaded files / outputs | Process the job | Contract | Minutes; ≤ 1 h output; ≤ 48 h backstop if deletion fails |
| Welcome-grant claim (keyed hash of email) | Stop repeat welcome grants | Legitimate interest | 12 months |
| Server logs | Security, debugging | Legitimate interest | ≤ 30 days |
| Error reports | Fix bugs | Legitimate interest | ≤ 90 days, PII scrubbed |
| Marketing email | Product news | Consent (unticked opt-in) | Until withdrawn |

## Cookies and storage

| Name | Type | Purpose | Lifetime |
|---|---|---|---|
| Session cookie (Better Auth) | Strictly necessary | Keep you signed in | Session / 30 days if "remember me" |
| CSRF token | Strictly necessary | Security | Session |
| `theme` (localStorage) | Strictly necessary (user-requested setting) | Remember light/dark choice | Until cleared |
| Cache Storage (engines/models) | Strictly necessary for the requested tool | Avoid re-downloading processing code | Until cleared |
| Paddle checkout cookies | Set by Paddle inside checkout only | Payment | Per Paddle's policy — link it |

No analytics cookies. Analytics tool must be cookieless and not store IPs (self-hosted Umami or Plausible-style).

## Processors (list in Privacy, sign DPAs where offered)

Hosting (EU VPS), Cloudflare (CDN/security, R2 storage), Postgres host (if managed), Paddle (payments, merchant of record — also an independent controller for billing), transactional email provider, error tracking, serverless GPU provider (processes files transiently), analytics (if hosted). For each: name, purpose, location, transfer mechanism.

The serverless GPU provider receives user files for processing → must be under a DPA, must not retain inputs beyond the job, EU or SCC-covered region. Check this before choosing it (milestone 5).

## Jurisdiction notes

**EU / UK (GDPR, UK GDPR, ePrivacy).** Applies because we target those users. Covered by the design above plus: data-subject rights (access, deletion, export, correction, objection) — self-serve in settings + email, answer within 1 month; breach notification process (72 h to the authority where required); records of processing (a simple internal doc); SCCs with non-EU processors. Non-EU controllers targeting the EU may need an **EU representative** (Art. 27) — see "Needs a lawyer".

**Uzbekistan (Law "On Personal Data" No. ZRU-547).** Since the amendments in force from 27 March 2026, personal data of Uzbek citizens may be stored abroad if conditions are met (e.g. a country with adequate protection, or approved standard contractual clauses), while specific sensitive categories (e.g. biometric/genetic data) must stay on servers in Uzbekistan. We collect none of the local-only categories. Hosting in the EU is our intended route; confirm with a local lawyer whether database registration or notification is still required for a business owner based in Uzbekistan.

**US.** CCPA/CPRA thresholds (revenue/volume) won't apply at launch; our privacy page covers the substance anyway. Not directed at children under 13 (COPPA) — Terms set minimum age 16 (to cover the GDPR default without parental-consent flows).

**Consumer and tax.** Paddle is the seller of record: it shows prices with the right taxes, issues invoices, handles VAT/sales tax and chargebacks. Our Terms describe the service and credits; Paddle's buyer terms cover the sale itself. Your own income in Uzbekistan (payouts from Paddle) is a separate tax matter — see open questions.

**Accessibility.** Target WCAG 2.2 AA (built into the design system). The European Accessibility Act exempts microenterprise service providers, but meeting AA anyway is cheap when built in, and helps SEO.

## Acceptable use (Terms)

Prohibited: illegal content; child sexual abuse material (zero tolerance, report to authorities); content you don't have rights to process where that infringes someone's rights; malware; attempts to overload, scrape, or reverse-engineer the service; reselling via automated access without an API key; using the service to harass or dox people.

Specific notes:
- **Stem separation, transcription, background removal on third-party content:** the user is responsible for having the rights for their intended use. Say so on those tool pages in one line, without scaring users.
- We don't publish or host user content, so there's no public-content moderation. Keep an abuse contact and a process to disable accounts.

## Model and code licenses

Third-party code and model weights have their own licenses. Some popular background-removal weights (e.g. BRIA RMBG 1.4 / 2.0) are **non-commercial** — using them in this product would violate their license. Every model and library goes through `13-licenses.md` before use.

## Security obligations

GDPR requires "appropriate technical measures" — see `11-security.md`. Keep a short security note in the Privacy page (encryption in transit, deletion windows, access controls).

## Needs a lawyer (before first payment)

1. Final review of Privacy Policy, Terms, Refund Policy.
2. Whether an EU representative (GDPR Art. 27) and UK representative are required for this processing profile.
3. Uzbekistan: registration/notification duties as an operator; confirm the EU-hosting transfer route under the 2026 amendments.
4. Governing law and dispute venue for Terms.
5. Business form in Uzbekistan for receiving Paddle payouts (sole proprietor / IT Park residency) and its tax treatment — with an accountant.
