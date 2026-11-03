import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { SUPPORT_EMAIL } from "@/config/site";
import "@/styles/aca-home.css";

const Terms = () => {
  return (
    <>
      <MarketingNav />
      <main className="aca-marketing">
        <section className="section section--tight" style={{ paddingTop: 80 }}>
          <div className="wrap" style={{ maxWidth: 860 }}>
            <header className="sect-head" style={{ marginBottom: 40 }}>
              <span className="kicker">Legal</span>
              <h1 className="h-section">Terms & Conditions</h1>
              <p className="lead">Last updated: January 2026</p>
            </header>

            <div style={{ display: "flex", flexDirection: "column", gap: 40, fontSize: 15, lineHeight: 1.7, color: "var(--ink-2)" }}>
              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>1. Introduction</h2>
                <p>
                  Welcome to Automated Client Acquisition. These Terms and Conditions govern your use of our website
                  and services operated by Sartoux Group, a company registered in England and Wales.
                </p>
                <p>
                  By accessing or using Automated Client Acquisition, you agree to be bound by these Terms. If you
                  disagree with any part of these terms, you may not access our service.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>2. Company Information</h2>
                <p>Automated Client Acquisition is operated by:</p>
                <address className="aca-card" style={{ fontStyle: "normal", background: "var(--card)", maxWidth: 480 }}>
                  <strong>Sartoux Group</strong><br />
                  Amelia House, Crescent Road<br />
                  Worthing, West Sussex<br />
                  England, BN11 1QR<br />
                  Company Number: 12340219
                </address>
                <p>
                  For any questions regarding these terms, please contact us at{" "}
                  <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--accent)", textDecoration: "underline" }}>
                    {SUPPORT_EMAIL}
                  </a>
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>3. Definitions</h2>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li><strong>"Service"</strong> refers to the Automated Client Acquisition platform, including all features, tools, and content provided.</li>
                  <li><strong>"User"</strong> refers to any individual or entity that accesses or uses our Service.</li>
                  <li><strong>"Content"</strong> refers to any text, images, videos, or other materials created, uploaded, or shared through our Service.</li>
                  <li><strong>"Subscription"</strong> refers to paid access to our Service through ACA Xtreme membership or other payment plans.</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>4. Account Registration</h2>
                <p>To use certain features of our Service, you must register for an account. When registering, you agree to:</p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li>Provide accurate, current, and complete information</li>
                  <li>Maintain and promptly update your account information</li>
                  <li>Keep your password secure and confidential</li>
                  <li>Accept responsibility for all activities under your account</li>
                  <li>Notify us immediately of any unauthorized use of your account</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>5. Acceptable Use</h2>
                <p>You agree not to use Automated Client Acquisition to:</p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li>Violate any applicable laws or regulations</li>
                  <li>Infringe on intellectual property rights of others</li>
                  <li>Create or distribute harmful, offensive, or misleading content</li>
                  <li>Attempt to gain unauthorized access to our systems or other users' accounts</li>
                  <li>Interfere with or disrupt the integrity of our Service</li>
                  <li>Use automated systems or bots to access the Service without permission</li>
                  <li>Engage in any activity that could damage our reputation or business</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>6. Intellectual Property</h2>
                <h3 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 17, color: "var(--ink)" }}>Our Content</h3>
                <p>
                  The Service and its original content, features, and functionality are owned by Sartoux Group
                  and are protected by international copyright, trademark, and other intellectual property laws.
                </p>
                <h3 style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 17, color: "var(--ink)" }}>Your Content</h3>
                <p>
                  You retain ownership of any content you create using our Service. By using Automated Client Acquisition,
                  you grant us a limited license to store, process, and display your content solely for the
                  purpose of providing the Service to you.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>7. Subscriptions and Payments</h2>
                <p>
                  Access to Automated Client Acquisition is provided through ACA Xtreme membership. Subscription terms,
                  pricing, and billing are governed by our payment processor and the ACA Xtreme membership terms.
                </p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li>Subscriptions are billed on a recurring basis</li>
                  <li>You may cancel your subscription at any time</li>
                  <li>Refunds are handled according to our refund policy</li>
                  <li>We reserve the right to change pricing with reasonable notice</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>8. Third-Party Services</h2>
                <p>
                  Automated Client Acquisition integrates with various third-party services (such as AI providers,
                  social media platforms, and cloud storage). Your use of these integrations is subject
                  to the respective third-party terms of service. We are not responsible for the practices
                  of third-party services.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>9. Disclaimer of Warranties</h2>
                <p>
                  Automated Client Acquisition is provided "as is" and "as available" without warranties of any kind,
                  whether express or implied, including but not limited to implied warranties of merchantability,
                  fitness for a particular purpose, and non-infringement.
                </p>
                <p>
                  We do not warrant that the Service will be uninterrupted, secure, or error-free, or that
                  any content generated through AI tools will be accurate, complete, or suitable for any purpose.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>10. Limitation of Liability</h2>
                <p>
                  To the maximum extent permitted by law, Sartoux Group shall not be liable for any indirect,
                  incidental, special, consequential, or punitive damages, or any loss of profits or revenues,
                  whether incurred directly or indirectly, or any loss of data, use, goodwill, or other
                  intangible losses resulting from:
                </p>
                <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  <li>Your use or inability to use the Service</li>
                  <li>Any unauthorized access to or use of our servers</li>
                  <li>Any interruption or cessation of transmission to or from the Service</li>
                  <li>Any bugs, viruses, or other harmful code transmitted through the Service</li>
                </ul>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>11. Indemnification</h2>
                <p>
                  You agree to indemnify, defend, and hold harmless Sartoux Group and its officers, directors,
                  employees, and agents from any claims, liabilities, damages, losses, and expenses arising
                  from your use of the Service or violation of these Terms.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>12. Termination</h2>
                <p>
                  We may terminate or suspend your account and access to the Service immediately, without
                  prior notice, for any reason, including breach of these Terms. Upon termination, your
                  right to use the Service will cease immediately.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>13. Changes to Terms</h2>
                <p>
                  We reserve the right to modify these Terms at any time. We will notify users of any material
                  changes by posting the new Terms on this page and updating the "Last updated" date. Your
                  continued use of the Service after such changes constitutes acceptance of the new Terms.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>14. Governing Law</h2>
                <p>
                  These Terms shall be governed by and construed in accordance with the laws of England and Wales,
                  without regard to its conflict of law provisions. Any disputes arising from these Terms or your
                  use of the Service shall be subject to the exclusive jurisdiction of the courts of England and Wales.
                </p>
              </section>

              <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <h2 className="h-card" style={{ fontSize: 22 }}>15. Contact Us</h2>
                <p>If you have any questions about these Terms, please contact us at:</p>
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
              </section>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
};

export default Terms;
