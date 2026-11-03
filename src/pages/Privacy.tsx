import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { SUPPORT_EMAIL } from "@/config/site";
import "@/styles/aca-home.css";

const Privacy = () => {
  return (
    <>
      <MarketingNav />
      <main className="aca-marketing">
        <section className="section section--tight" style={{ paddingTop: 80 }}>
          <div className="wrap" style={{ maxWidth: 860 }}>
            <header className="sect-head" style={{ marginBottom: 40 }}>
              <span className="kicker">Legal</span>
              <h1 className="h-section">Privacy Policy</h1>
              <p className="lead">Last updated: January 2026</p>
            </header>

            <div style={{ display: "flex", flexDirection: "column", gap: 40, fontSize: 15, lineHeight: 1.7, color: "var(--ink-2)" }}>
              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>1. Introduction</h2>
                <p>
                  Sartoux Group ("we", "us", or "our") operates Automated Client Acquisition. This Privacy Policy
                  explains how we collect, use, disclose, and safeguard your information when you use our
                  Service.
                </p>
                <p>
                  We are committed to protecting your privacy and ensuring that your personal data is
                  handled in a safe and responsible manner. Please read this policy carefully to understand
                  our practices regarding your personal data.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>2. Data Controller</h2>
                <p>The data controller responsible for your personal data is:</p>
                <address className="aca-card" style={{ fontStyle: "normal", background: "var(--card)", maxWidth: 480 }}>
                  <strong>Sartoux Group</strong><br />
                  Amelia House, Crescent Road<br />
                  Worthing, West Sussex<br />
                  England, BN11 1QR<br />
                  Company Number: 12340219<br /><br />
                  Email:{" "}
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--accent)", textDecoration: "underline" }}>
                    {SUPPORT_EMAIL}
                  </a>
                </address>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>3. Information We Collect</h2>

                <h3 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 17, color: "var(--ink)" }}>Information You Provide</h3>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong>Account Information:</strong> Name, email address, password, and profile details when you create an account</li>
                  <li><strong>Payment Information:</strong> Billing details processed through our secure payment providers</li>
                  <li><strong>Content:</strong> Text, images, and other materials you create or upload using our Service</li>
                  <li><strong>Communications:</strong> Information you provide when contacting our support team</li>
                  <li><strong>Integration Data:</strong> Credentials and data from third-party services you connect to Automated Client Acquisition</li>
                </ul>

                <h3 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 17, color: "var(--ink)" }}>Information Collected Automatically</h3>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong>Usage Data:</strong> Information about how you use our Service, including features accessed and actions taken</li>
                  <li><strong>Device Information:</strong> Browser type, operating system, device identifiers, and IP address</li>
                  <li><strong>Cookies and Similar Technologies:</strong> Data collected through cookies, web beacons, and similar technologies</li>
                  <li><strong>Log Data:</strong> Server logs including access times, pages viewed, and referring URLs</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>4. How We Use Your Information</h2>
                <p>We use the information we collect to:</p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li>Provide, maintain, and improve our Service</li>
                  <li>Process transactions and manage your subscription</li>
                  <li>Send you technical notices, updates, and support messages</li>
                  <li>Respond to your comments, questions, and requests</li>
                  <li>Monitor and analyze trends, usage, and activities</li>
                  <li>Detect, investigate, and prevent fraudulent or unauthorized activities</li>
                  <li>Personalize and improve your experience</li>
                  <li>Comply with legal obligations</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>5. Legal Basis for Processing (GDPR)</h2>
                <p>Under the General Data Protection Regulation (GDPR), we process your personal data based on:</p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong>Contract Performance:</strong> Processing necessary to provide our Service to you</li>
                  <li><strong>Legitimate Interests:</strong> Processing for our legitimate business interests, such as improving our Service and preventing fraud</li>
                  <li><strong>Consent:</strong> Processing based on your explicit consent, which you may withdraw at any time</li>
                  <li><strong>Legal Obligation:</strong> Processing necessary to comply with applicable laws</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>6. Information Sharing</h2>
                <p>We may share your information with:</p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong>Service Providers:</strong> Third parties that perform services on our behalf, such as payment processing, hosting, and analytics</li>
                  <li><strong>AI Providers:</strong> Content and prompts may be processed by AI service providers to deliver our features</li>
                  <li><strong>Connected Platforms:</strong> Third-party services you choose to integrate with Automated Client Acquisition</li>
                  <li><strong>Legal Requirements:</strong> When required by law, legal process, or to protect our rights</li>
                  <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
                </ul>
                <p>We do not sell your personal information to third parties.</p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>7. Data Retention</h2>
                <p>
                  We retain your personal data for as long as necessary to fulfill the purposes outlined in
                  this Privacy Policy, unless a longer retention period is required or permitted by law.
                </p>
                <p>
                  When you delete your account, we will delete or anonymize your personal data within a
                  reasonable timeframe, except where we need to retain certain information for legal or
                  legitimate business purposes.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>8. Data Security</h2>
                <p>
                  We implement appropriate technical and organizational measures to protect your personal
                  data against unauthorized access, alteration, disclosure, or destruction. These measures include:
                </p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li>Encryption of data in transit and at rest</li>
                  <li>Secure authentication mechanisms</li>
                  <li>Regular security assessments and updates</li>
                  <li>Access controls and employee training</li>
                </ul>
                <p>
                  However, no method of transmission over the Internet or electronic storage is completely
                  secure, and we cannot guarantee absolute security.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>9. International Data Transfers</h2>
                <p>
                  Your information may be transferred to and processed in countries other than your own.
                  When we transfer personal data outside the UK or European Economic Area, we ensure
                  appropriate safeguards are in place, such as:
                </p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li>Standard contractual clauses approved by relevant authorities</li>
                  <li>Transfers to countries with adequate data protection laws</li>
                  <li>Other legally recognized transfer mechanisms</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>10. Your Rights</h2>
                <p>Under applicable data protection laws, you have the right to:</p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong>Access:</strong> Request a copy of your personal data</li>
                  <li><strong>Rectification:</strong> Request correction of inaccurate data</li>
                  <li><strong>Erasure:</strong> Request deletion of your personal data</li>
                  <li><strong>Restriction:</strong> Request restriction of processing</li>
                  <li><strong>Portability:</strong> Request transfer of your data to another service</li>
                  <li><strong>Objection:</strong> Object to processing based on legitimate interests</li>
                  <li><strong>Withdraw Consent:</strong> Withdraw consent where processing is based on consent</li>
                </ul>
                <p>
                  To exercise these rights, please contact us at{" "}
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--accent)", textDecoration: "underline" }}>
                    {SUPPORT_EMAIL}
                  </a>
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>11. Cookies</h2>
                <p>
                  We use cookies and similar tracking technologies to collect and track information about
                  your activity on our Service. Cookies are small data files stored on your device.
                </p>
                <p>We use the following types of cookies:</p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong>Essential Cookies:</strong> Required for the Service to function properly</li>
                  <li><strong>Analytics Cookies:</strong> Help us understand how users interact with our Service</li>
                  <li><strong>Functional Cookies:</strong> Remember your preferences and settings</li>
                </ul>
                <p>
                  You can control cookies through your browser settings. Note that disabling certain cookies
                  may affect the functionality of our Service.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>12. Children's Privacy</h2>
                <p>
                  Our Service is not intended for children under 16 years of age. We do not knowingly
                  collect personal data from children. If you are a parent or guardian and believe your
                  child has provided us with personal data, please contact us immediately.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>13. Changes to This Policy</h2>
                <p>
                  We may update this Privacy Policy from time to time. We will notify you of any material
                  changes by posting the new Privacy Policy on this page and updating the "Last updated"
                  date. We encourage you to review this Privacy Policy periodically.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>14. Contact Us</h2>
                <p>If you have any questions about this Privacy Policy or our data practices, please contact us at:</p>
                <address className="aca-card" style={{ fontStyle: "normal", background: "var(--card)", maxWidth: 480 }}>
                  <strong>Sartoux Group</strong><br />
                  Amelia House, Crescent Road<br />
                  Worthing, West Sussex<br />
                  England, BN11 1QR<br /><br />
                  Email:{" "}
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--accent)", textDecoration: "underline" }}>
                    {SUPPORT_EMAIL}
                  </a>
                </address>
                <p>
                  You also have the right to lodge a complaint with the Information Commissioner's Office (ICO)
                  if you believe your data protection rights have been violated.
                </p>
              </section>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
};

export default Privacy;
