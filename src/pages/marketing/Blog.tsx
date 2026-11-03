import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { Link } from "react-router-dom";
import { useSEO } from "@/hooks/useSEO";
import { blogPosts, featuredPost } from "@/data/blogPosts";
import { useDbBlogPosts } from "@/hooks/useBlogPosts";
import { useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { BlogCardArt } from "@/components/BlogCardArt";
import "@/styles/aca-home.css";
import "@/styles/marketing-resources.css";

export default function Blog() {
  const seo = useSEO({
    title: "Blog - AI Agency, Outreach & AI Business Insights",
    description:
      "How to start an AI agency, make money with AI, get clients, and scale - practical guides from the team that built ACA.",
    canonical: "/blog",
    keywords: [
      "AI agency blog",
      "how to make money with AI",
      "AI business",
      "outreach tips",
    ],
  });

  const { data: dbPosts = [] } = useDbBlogPosts();
  const [category, setCategory] = useState("All articles");
  const [search, setSearch] = useState("");

  // Merge DB posts (newer, AI-generated) with static posts. DB posts take priority on slug collision.
  const staticSlugs = new Set(blogPosts.map((p) => p.slug));
  const newDbPosts = dbPosts.filter((p) => !staticSlugs.has(p.slug));
  const allPosts = [...newDbPosts, ...blogPosts];

  const featured =
    allPosts.find((p) => p.slug === featuredPost?.slug) ?? allPosts[0];
  const categories = [
    "All articles",
    ...Array.from(new Set(allPosts.map((p) => p.category))),
  ];
  const others = allPosts.filter(
    (p) =>
      p.slug !== featured?.slug &&
      (category === "All articles" || p.category === category) &&
      `${p.title} ${p.description} ${p.category}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );

  return (
    <>
      {seo}
      <MarketingNav />
      <main className="aca-marketing mkt-page resource-page resource-blog">
        <section className="resource-hero">
          <div className="wrap resource-hero__split">
            <div>
              <span className="kicker">The ACA field notes</span>
              <h1>
                Practical guides to <em>winning clients with AI.</em>
              </h1>
              <p className="lead">
                Practical guides to finding buyers, starting conversations and
                building an AI-native agency. Written for the people doing the
                work.
              </p>
            </div>
            <div className="resource-hero__aside">
              <span className="resource-label">Ideas you can put to work</span>
              <p>
                Outreach. Content. Buying signals.
                <br />A clearer path from attention to pipeline.
              </p>
              <a href="#articles" className="resource-text-link">
                Explore the articles <ArrowUpRight size={18} />
              </a>
            </div>
          </div>
        </section>

        {featured && (
          <section className="section" style={{ paddingTop: 0 }}>
            <div className="wrap">
              <Link to={`/blog/${featured.slug}`} className="resource-featured">
                <div className="resource-featured__art">
                  {featured.coverImage ? (
                    <img src={featured.coverImage} alt="" loading="eager" />
                  ) : (
                    <BlogCardArt post={featured} />
                  )}
                  <span className="resource-featured__art-note">
                    Editorial illustration
                  </span>
                </div>
                <div className="resource-featured__copy">
                  <span className="resource-label">
                    Featured · {featured.category}
                  </span>
                  <h2>{featured.title}</h2>
                  <p>{featured.description}</p>
                  <div className="resource-byline">
                    <span>
                      {featured.author} · {featured.readTime}
                    </span>
                    <ArrowUpRight size={24} />
                  </div>
                </div>
              </Link>
            </div>
          </section>
        )}

        <section className="section section--tight" id="articles">
          <div className="wrap">
            <header className="resource-library-head">
              <div>
                <span className="kicker">Read. Try. Improve.</span>
                <h2 className="h-section">The article library.</h2>
              </div>
              <label className="resource-search">
                <Search size={18} aria-hidden="true" />
                <span className="sr-only">Search articles</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find your next idea…"
                />
              </label>
            </header>
            <div
              className="resource-filter"
              aria-label="Filter articles by category"
            >
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={category === item}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <p className="resource-result-count" aria-live="polite">
              {others.length} {others.length === 1 ? "article" : "articles"}
              {search && ` matching “${search}”`}
            </p>
            {others.length === 0 && (
              <div className="resource-empty">
                <h3>No articles found.</h3>
                <p>Try another topic or choose a different category.</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCategory("All articles");
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
            <div className="aca-card-grid">
              {others.map((p) => (
                <Link
                  key={p.slug}
                  to={`/blog/${p.slug}`}
                  className="aca-card aca-card--art"
                >
                  <div className="aca-card__art">
                    {p.coverImage ? (
                      <img
                        src={p.coverImage}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <BlogCardArt post={p} />
                    )}
                  </div>
                  <div className="aca-card__body">
                    <span className="aca-card__tag">{p.category}</span>
                    <h3 className="aca-card__title">{p.title}</h3>
                    <p className="aca-card__excerpt">{p.description}</p>
                    <span className="aca-card__meta">
                      {p.author} · {p.readTime}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
