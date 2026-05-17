"use client";

import { SearchToolResultItem } from "@/app/api/chat/search-tool";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import { MailIcon } from "lucide-react";

type SearchToolOutput = {
  emailChunks: SearchToolResultItem[];
};

export type SearchToolResultProps = {
  part: ToolUIPart;
  className?: string;
};

export const SearchToolResult = ({
  part,
  className,
}: SearchToolResultProps) => {
  const isOutputAvailable = part.state === "output-available";
  const output = part.output as SearchToolOutput | undefined;
  const emailChunks = output?.emailChunks ?? [];

  return (
    <Tool className={cn("mb-4", className)}>
      <ToolHeader title="Search Emails" type={part.type} state={part.state} />
      <ToolContent>
        <ToolInput input={part.input} />

        {isOutputAvailable && (
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Results
              </h4>
              <Badge variant="secondary" className="text-xs">
                {emailChunks.length} email{emailChunks.length !== 1 ? "s" : ""}
              </Badge>
            </div>

            {emailChunks.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No emails found for the given query.
              </p>
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {emailChunks.map((emailChunk) => (
                  <EmailCard key={emailChunk.id} emailChunk={emailChunk} />
                ))}
              </div>
            )}
          </div>
        )}
      </ToolContent>
    </Tool>
  );
};

function EmailCard({ emailChunk }: { emailChunk: SearchToolResultItem }) {
  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm transition-colors hover:bg-accent/40">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <MailIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{emailChunk.subject}</p>
            <Badge variant="outline" className="shrink-0 text-xs">
              {typeof emailChunk.score === "number"
                ? emailChunk.score.toFixed(3)
                : emailChunk.score}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span className="truncate">
              <span className="font-medium">From:</span> {emailChunk.from}
            </span>
            <span className="truncate">
              <span className="font-medium">To:</span>{" "}
              {Array.isArray(emailChunk.to)
                ? emailChunk.to.join(", ")
                : emailChunk.to}
            </span>
            <span className="truncate">
              <span className="font-medium">Date:</span>{" "}
              {new Date(emailChunk.timestamp).toLocaleDateString()}
            </span>
          </div>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {emailChunk.snippet}
          </p>
        </div>
      </div>
    </div>
  );
}
