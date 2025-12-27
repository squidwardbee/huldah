import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getNews, type NewsArticle } from '../../lib/api';

const CATEGORIES = [
  { id: 'general', label: 'TOP' },
  { id: 'business', label: 'BUSINESS' },
  { id: 'technology', label: 'TECH' },
  { id: 'science', label: 'SCIENCE' },
];

export function GlobalNews() {
  const [category, setCategory] = useState('general');

  const { data: articles = [], isLoading, error } = useQuery({
    queryKey: ['news', category],
    queryFn: () => getNews({ category, limit: 8 }),
    staleTime: 300000, // 5 minutes
    refetchInterval: 300000,
  });

  return (
    <div className="bg-terminal-surface/60 border border-terminal-border rounded-lg overflow-hidden">
      {/* Header with tabs */}
      <div className="px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm font-semibold text-white tracking-wide">
            GLOBAL NEWS
          </h2>
          <div className="flex gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`
                  px-2 py-1 text-[10px] font-mono rounded transition-colors
                  ${
                    category === cat.id
                      ? 'bg-neon-cyan/20 text-neon-cyan'
                      : 'text-terminal-muted hover:text-white hover:bg-terminal-border/50'
                  }
                `}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse flex gap-3">
                <div className="w-16 h-16 bg-terminal-border rounded flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-terminal-border rounded w-3/4" />
                  <div className="h-3 bg-terminal-border/50 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-4 text-terminal-muted text-sm">Failed to load news</div>
        ) : articles.length === 0 ? (
          <div className="p-4 text-terminal-muted text-sm">No news available</div>
        ) : (
          <div className="divide-y divide-terminal-border/50">
            {articles.map((article, index) => (
              <NewsCard key={`${article.url}-${index}`} article={article} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewsCard({ article }: { article: NewsArticle }) {
  const timeAgo = getTimeAgo(article.publishedAt);

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-4 py-3 hover:bg-terminal-border/20 transition-colors group"
    >
      <div className="flex gap-3">
        {/* Thumbnail */}
        {article.urlToImage && (
          <img
            src={article.urlToImage}
            alt=""
            className="w-16 h-16 rounded object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-white text-sm font-medium line-clamp-2 group-hover:text-neon-cyan transition-colors">
            {article.title}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-neon-cyan font-mono">{article.source}</span>
            <span className="text-[10px] text-terminal-muted">{timeAgo}</span>
          </div>
        </div>
      </div>
    </a>
  );
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
