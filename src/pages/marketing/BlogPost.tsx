import { useParams, Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { MarketingFooter } from "@/components/marketing";
import { useSEO } from "@/hooks/useSEO";
import { StructuredData } from "@/components/seo/StructuredData";
import { getBlogPost, getRelatedPosts, blogPosts } from "@/data/blogPosts";
import { useDbBlogPost, useDbBlogPosts } from "@/hooks/useBlogPosts";
import { ArrowLeft, Check, ChevronDown, Copy, RefreshCw } from "lucide-react";
import "@/styles/aca-home.css";
import "@/styles/aca-pillar.css";
import { Logo } from "@/components/marketing/Logo";
import "@/styles/marketing-continuity.css";
import "@/styles/blog-editorial.css";
import { BlogCardArt } from "@/components/BlogCardArt";
import { Button } from "@/components/ui/button";

const SITE_URL = "https://www.automatedclientacquisition.com";

function articleContents(content: string) {
  return Array.from(
    content.matchAll(/<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi),
  ).flatMap((match) => {
    const id = match[2].match(/\bid=["']([^"']+)["']/i)?.[1];
    const title = match[3]
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;/g, "’")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, " ")
      .trim();
    return id && title ? [{ id, title, level: Number(match[1]) as 2 | 3 }] : [];
  });
}

function ArticleStatus({
  failed = false,
  onRetry,
}: {
  failed?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="pillar aca-marketing mkt-page mkt-article blog-editorial">
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" aria-label="ACA home">
            <Logo size={32} />
          </Link>
          <Link to="/blog" className="topbar__crumb">
            All articles
          </Link>
        </div>
      </header>
      <main className="article-status" aria-busy={!failed}>
        <span className="kicker">ACA field notes</span>
        <h1>
          {failed ? "We couldn’t load this article." : "Loading the article…"}
        </h1>
        <p role={failed ? "alert" : "status"}>
          {failed
            ? "The article service didn’t respond. Try again or browse the other guides."
            : "The guide will appear here as soon as it loads."}
        </p>
        {failed ? (
          <div className="article-status-actions">
            <Button variant="cta" onClick={onRetry}>
              <RefreshCw size={16} />
              Try again
            </Button>
            <Link to="/blog">
              Browse the blog <ArrowLeft size={16} />
            </Link>
          </div>
        ) : (
          <div className="article-loading" aria-hidden="true">
            <div className="article-skeleton-line" />
            <div className="article-skeleton-line" />
            <div className="article-skeleton-line" />
          </div>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}

function NotFound() {
  return (
    <div className="pillar aca-marketing mkt-page mkt-article blog-editorial">
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" aria-label="ACA home">
            <Logo size={32} />
          </Link>
          <Link to="/blog" className="topbar__crumb">
            All articles
          </Link>
        </div>
      </header>
      <main className="article-status">
        <span className="kicker">ACA field notes</span>
        <h1>Article not found.</h1>
        <p>
          This guide may have moved. Browse the library to find the topic you
          need.
        </p>
        <div className="article-status-actions">
          <Button variant="cta" asChild>
            <Link to="/blog">
              <ArrowLeft size={16} />
              Back to the blog
            </Link>
          </Button>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const staticPost = slug ? getBlogPost(slug) : undefined;
  const {
    data: dbPost,
    isLoading: dbLoading,
    isFetching: dbFetching,
    error: dbError,
    refetch,
  } = useDbBlogPost(staticPost ? undefined : slug);
  const { data: dbPosts = [] } = useDbBlogPosts();
  const post = staticPost ?? dbPost;
  const progressRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const proseRef = useRef<HTMLElement | null>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const tocItems = post?.tableOfContents.length
    ? post.tableOfContents
    : articleContents(post?.content ?? "");
  const tocSignature = tocItems.map((item) => item.id).join("|");

  useEffect(() => {
    setContentsOpen(false);
    setCopied(false);
    return () => clearTimeout(copyTimer.current);
  }, [slug]);

  useEffect(() => {
    proseRef.current?.querySelectorAll("table").forEach((table, index) => {
      if (table.parentElement?.classList.contains("article-table-scroll"))
        return;
      const wrapper = document.createElement("div");
      wrapper.className = "article-table-scroll";
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute(
        "aria-label",
        `Article table ${index + 1}. Scroll horizontally to see all columns.`,
      );
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
    const wrappers = Array.from(
      proseRef.current?.querySelectorAll<HTMLElement>(
        ".article-table-scroll",
      ) ?? [],
    );
    function updateTableOverflow() {
      wrappers.forEach((wrapper) => {
        wrapper.dataset.scrollable = String(
          wrapper.scrollWidth > wrapper.clientWidth + 1,
        );
      });
    }
    const observer = new ResizeObserver(updateTableOverflow);
    wrappers.forEach((wrapper) => observer.observe(wrapper));
    updateTableOverflow();
    return () => observer.disconnect();
  }, [post?.content]);

  async function copyArticleLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/blog/${post!.slug}`,
      );
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  useEffect(() => {
    function onScroll() {
      const article = proseRef.current;
      const bar = progressRef.current;
      if (!article || !bar) return;
      const rect = article.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const passed = -rect.top;
      const pct =
        total <= 0
          ? rect.bottom <= window.innerHeight
            ? 100
            : 0
          : Math.max(0, Math.min(100, (passed / total) * 100));
      bar.style.width = pct + "%";
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const observer = new ResizeObserver(onScroll);
    if (proseRef.current) observer.observe(proseRef.current);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer.disconnect();
    };
  }, [slug, post?.content]);

  useEffect(() => {
    if (!post || !tocSignature) return;
    const links =
      document.querySelectorAll<HTMLAnchorElement>(".pillar .toc a");
    const sections = tocSignature
      .split("|")
      .map((id) => ({ id }))
      .map((t) => document.getElementById(t.id))
      .filter((x): x is HTMLElement => !!x);
    if (!sections.length) return;
    let frame = 0;
    function updateActiveSection() {
      frame = 0;
      let activeId = sections[0].id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= 140) activeId = section.id;
      }
      links.forEach((link) =>
        link.classList.toggle(
          "is-active",
          link.getAttribute("href") === `#${activeId}`,
        ),
      );
    }
    function scheduleUpdate() {
      if (!frame) frame = requestAnimationFrame(updateActiveSection);
    }
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    updateActiveSection();
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      cancelAnimationFrame(frame);
    };
  }, [post, slug, tocSignature]);

  const seoElement = useSEO(
    post
      ? {
          title: post.title,
          description: post.description,
          canonical: `/blog/${post.slug}`,
          ogType: "article",
          keywords: post.keywords,
          article: {
            publishedTime: post.publishDate,
            modifiedTime: post.modifiedDate,
            author: post.author,
            tags: post.keywords,
            section: post.category,
          },
        }
      : {
          title: "Article Not Found",
          description: "This article could not be found.",
          noindex: true,
        },
  );

  if (!post && (dbLoading || dbFetching)) return <ArticleStatus />;
  if (!post && dbError && (dbError as { code?: string }).code !== "PGRST116")
    return (
      <ArticleStatus
        failed
        onRetry={() => {
          void refetch();
        }}
      />
    );
  if (!post)
    return (
      <>
        {seoElement}
        <NotFound />
      </>
    );

  const relatedPosts = getRelatedPosts(post.relatedSlugs);
  const allAvailable = [
    ...blogPosts,
    ...dbPosts.filter((p) => !blogPosts.find((s) => s.slug === p.slug)),
  ];
  const fallbackRelated =
    relatedPosts.length === 0
      ? allAvailable.filter((p) => p.slug !== post.slug).slice(0, 3)
      : relatedPosts;
  const canonicalUrl = `${SITE_URL}/blog/${post.slug}`;

  const faqItems = (() => {
    const faqs: Array<{ question: string; answer: string }> = [];
    const faqMatch = post.content.match(/<h2[^>]*id="faq"[^>]*>[\s\S]*$/i);
    if (!faqMatch) return faqs;
    const faqSection = faqMatch[0];
    const h3Regex = /<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = h3Regex.exec(faqSection)) !== null) {
      const question = match[1].replace(/<[^>]+>/g, "").trim();
      const answer = match[2].replace(/<[^>]+>/g, "").trim();
      if (question && answer) faqs.push({ question, answer });
    }
    return faqs;
  })();

  const dateUpper = new Date(post.publishDate)
    .toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase();
  const initials = post.author
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const sections = tocSignature.split("|").map((id) => ({ id })).length;

  return (
    <>
      {seoElement}
      <StructuredData
        type="Article"
        headline={post.title}
        description={post.description}
        datePublished={post.publishDate}
        dateModified={post.modifiedDate}
        author={post.author}
        image={
          post.coverImage
            ? post.coverImage.startsWith("http")
              ? post.coverImage
              : `${SITE_URL}${post.coverImage}`
            : undefined
        }
        url={canonicalUrl}
        wordCount={post.wordCount}
        articleSection={post.cluster}
        keywords={post.keywords}
        speakable={true}
      />
      <StructuredData
        type="BreadcrumbList"
        items={[
          { name: "Home", url: "/" },
          { name: "Blog", url: "/blog" },
          { name: post.title, url: `/blog/${post.slug}` },
        ]}
      />
      {faqItems.length > 0 && <StructuredData type="FAQPage" faqs={faqItems} />}

      <div className="pillar aca-marketing mkt-page mkt-article blog-editorial">
        <header className="topbar">
          <div className="topbar__inner">
            <Link to="/" className="topbar__brand" aria-label="ACA home">
              <Logo size={22} />
            </Link>
            <nav className="topbar__crumb" aria-label="Breadcrumb">
              <Link to="/blog">Blog</Link>
              <span className="sep">/</span>
              <span style={{ color: "#9A9485" }}>{post.category}</span>
            </nav>
            <Link to="/get-started" className="topbar__cta">
              Build free preview
            </Link>
          </div>
          <div className="progress" aria-hidden="true">
            <div className="progress__bar" ref={progressRef} />
          </div>
        </header>

        <main
          className={`article${sections ? "" : " article--no-contents"}`}
          ref={articleRef}
        >
          <section className="cover" aria-label="Article cover">
            <div className="cover__copy">
              <span className="kicker">
                <span className="live-dot" />
                Field notes · {post.category}
              </span>
              <h1 className="cover__title">{post.title.replace(/\*/g, "")}</h1>
              <p className="cover__lead">{post.description}</p>
              <div className="cover__meta">
                <div className="cover__byline__av">{initials}</div>
                <div className="cover__byline">
                  <div className="cover__byline__name">{post.author}</div>
                  <div className="cover__byline__meta">
                    {dateUpper} · {post.readTime.toUpperCase()}
                  </div>
                </div>
                {sections > 0 && (
                  <>
                    <div className="cover__meta__sep" />
                    <div className="cover__chapters">
                      <b>{sections}</b> sections
                    </div>
                  </>
                )}
              </div>
            </div>
            <figure className="cover__art">
              {post.coverImage ? (
                <img
                  className="article-cover-image"
                  src={post.coverImage}
                  alt=""
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <div className="article-cover-illustration" aria-hidden="true">
                  <BlogCardArt post={post} />
                </div>
              )}
              <figcaption>
                {post.coverImage ? "Article cover" : "Editorial illustration"}
              </figcaption>
            </figure>
          </section>

          {sections > 0 && (
            <aside className="rail" aria-label="Table of contents">
              <p className="rail__lab">In this article</p>
              <button
                type="button"
                className="article-contents-toggle"
                aria-expanded={contentsOpen}
                aria-controls="article-contents"
                onClick={() => setContentsOpen((open) => !open)}
              >
                In this article <ChevronDown size={17} />
              </button>
              <div
                id="article-contents"
                className="article-contents-body"
                hidden={!contentsOpen}
              >
                <nav aria-label="Article sections">
                  <ol className="toc">
                    {tocItems.map((t, i) => (
                      <li key={t.id}>
                        <a
                          href={`#${t.id}`}
                          className={`${i === 0 ? "is-active" : ""}${t.level === 3 ? " toc-link--sub" : ""}`}
                          onClick={() => setContentsOpen(false)}
                        >
                          <span className="toc__num">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>{t.title}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
                <div className="rail__share">
                  <button
                    type="button"
                    className="article-copy-link"
                    onClick={copyArticleLink}
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                    <span aria-live="polite">
                      {copied ? "Link copied" : "Copy article link"}
                    </span>
                  </button>
                </div>
              </div>
            </aside>
          )}

          <article
            className="prose"
            ref={proseRef}
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </main>

        <div className="endcap-wrap">
          <div className="endcap">
            <div className="bio">
              <div className="bio__av">{initials}</div>
              <div>
                <div className="bio__lab">Authored by</div>
                <h2 className="bio__name">{post.author}</h2>
                <p className="bio__bio">
                  {post.authorRole}. Writes about AI-native outbound,
                  distribution for indie operators, and how to actually book
                  meetings without an SDR team.
                </p>
              </div>
              <Link to="/get-started" className="bio__follow">
                Build free preview →
              </Link>
            </div>

            {fallbackRelated.length > 0 && (
              <section className="related">
                <div className="related__head">
                  <h2 className="related__title">Keep reading</h2>
                  <Link to="/blog" className="related__more">
                    All posts →
                  </Link>
                </div>
                <div className="related__grid">
                  {fallbackRelated.map((r) => (
                    <Link key={r.slug} to={`/blog/${r.slug}`} className="rcard">
                      <div className="rcard__art" aria-hidden="true">
                        {r.coverImage ? (
                          <img
                            src={r.coverImage}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <BlogCardArt post={r} />
                        )}
                      </div>
                      <div className="rcard__body">
                        <span className="rcard__kicker">{r.category}</span>
                        <h3 className="rcard__title">{r.title}</h3>
                        <span className="rcard__meta">
                          {r.readTime.toUpperCase()} ·{" "}
                          {new Date(r.publishDate)
                            .toLocaleDateString("en-US", {
                              month: "short",
                              day: "2-digit",
                              year: "numeric",
                            })
                            .toUpperCase()}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
        <MarketingFooter />
      </div>
    </>
  );
}
