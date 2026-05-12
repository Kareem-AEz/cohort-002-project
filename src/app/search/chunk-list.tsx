"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileTextIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";
import { LexicalSearchResult } from "./search";

function ChunkCard({ chunk }: { chunk: LexicalSearchResult }) {
  const [expanded, setExpanded] = useState(false);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  const formattedDate = formatDate(chunk.modifiedAt ?? chunk.createdAt);

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 rounded-full bg-primary/10">
          <FileTextIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-1">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base mb-0.5">{chunk.title}</h3>
              <p className="text-xs text-muted-foreground truncate">
                {chunk.sourcePath}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {chunk.score > 0 && (
                <Badge variant="outline" className="text-xs font-mono">
                  {chunk.score.toFixed(2)}
                </Badge>
              )}
              {formattedDate && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formattedDate}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant="secondary" className="text-xs">
              {chunk.folder}
            </Badge>
            {chunk.chunkTotal > 1 && (
              <Badge variant="outline" className="text-xs">
                Part {chunk.chunkIndex}/{chunk.chunkTotal}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {chunk.wordCount} words
            </Badge>
            {chunk.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                #{tag}
              </Badge>
            ))}
          </div>

          <p className="text-sm text-foreground/80 mt-3 line-clamp-2">
            {chunk.content.substring(0, 200).replace(/#+ /g, "")}
          </p>

          {expanded && (
            <div className="mt-3 pt-3 border-t">
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {chunk.content}
                </pre>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="mt-2 h-8 text-primary hover:text-primary px-2"
          >
            {expanded ? (
              <>
                <ChevronUpIcon className="h-3.5 w-3.5 mr-1" />
                Show less
              </>
            ) : (
              <>
                <ChevronDownIcon className="h-3.5 w-3.5 mr-1" />
                See more
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ChunkList({ chunks }: { chunks: LexicalSearchResult[] }) {
  if (chunks.length === 0) {
    return (
      <div className="text-center py-12">
        <FileTextIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">No entries found</h3>
        <p className="text-muted-foreground">Try adjusting your search query</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {chunks.map((chunk) => (
        <ChunkCard key={chunk.id} chunk={chunk} />
      ))}
    </div>
  );
}
