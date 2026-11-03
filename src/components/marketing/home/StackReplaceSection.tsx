import { StackReceipt } from "./mocks";

export function StackReplaceSection() {
  return (
    <section id="stack" className="section section--tight">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">What an AI agentic SDR actually costs</span>
          <h2 className="h-section">
            Cancel the stack. Cancel the SDR.<br />
            <em>Run the motion in ACA<span className="dot">.</span></em>
          </h2>
          <p className="lead">
            Whether you're stitching six tools and a human together, or paying an "AI SDR" platform $1,500-3,000/mo plus token markup, the bill looks the same. Here's what you stop paying for.
          </p>
        </header>

        <div className="stack-replace">
          <div className="stack-replace__receipt">
            <StackReceipt />
          </div>
          <div className="stack-replace__copy body-prose">
            <p>
              <em>ACA does the work of every line on that list for $67 a month.</em> $490 if you pay annually.
            </p>
            <p>
              We know how that number reads. It looks like a typo when sat next to $7,061. But the math is real, and the reason the number is what it is comes down to one decision: we don't proxy AI inference, we don't sell mailboxes by the seat, and we don't charge per send. We charge for the orchestration layer itself - the infrastructure - and we let you bring your own model, your own keys, your own bill.
            </p>
            <p>
              The tools you're replacing aren't expensive because they're sophisticated. They're expensive because they each carry their own AI margin, their own infrastructure overhead, their own salesforce. ACA carries one orchestration layer. You pay for that. Everything else - the inference, the deliverability, the data - flows through your own accounts at cost.
            </p>
            <p className="body-prose__emph">
              The first meeting ACA books pays for the year.<br />
              The second pays for the next decade.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
