"use client";

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

type GetEmailsToolEmail = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string | string[];
  cc?: string[];
  timestamp: string;
  inReplyTo?: string;
  references?: string[];
  body: string;
};

type GetEmailsToolOutput = {
  emails: GetEmailsToolEmail[];
};

export type GetEmailsToolResultProps = {
  part: ToolUIPart;
  className?: string;
};

export const GetEmailsToolResult = ({
  part,
  className,
}: GetEmailsToolResultProps) => {
  const isOutputAvailable = part.state === "output-available";
  const output = part.output as GetEmailsToolOutput | undefined;
  const emails = output?.emails ?? [];

  return (
    <Tool className={cn("mb-4", className)}>
      <ToolHeader title="Get Emails" type={part.type} state={part.state} />
      <ToolContent>
        <ToolInput input={part.input} />

        {isOutputAvailable && (
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Full Content
              </h4>
              <Badge variant="secondary" className="text-xs">
                {emails.length} email{emails.length !== 1 ? "s" : ""}
              </Badge>
            </div>

            {emails.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No emails matched the given ids.
              </p>
            ) : (
              <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
                {emails.map((email) => (
                  <EmailCard key={email.id} email={email} />
                ))}
              </div>
            )}
          </div>
        )}
      </ToolContent>
    </Tool>
  );
};

function EmailCard({ email }: { email: GetEmailsToolEmail }) {
  const recipients = Array.isArray(email.to) ? email.to.join(", ") : email.to;

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <MailIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-0.5">
            <p className="truncate font-medium text-sm">{email.subject}</p>
            <p className="text-muted-foreground text-xs">
              {new Date(email.timestamp).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground text-xs">
            <span className="truncate">
              <span className="font-medium">From:</span> {email.from}
            </span>
            <span className="truncate">
              <span className="font-medium">To:</span> {recipients}
            </span>
          </div>
          <p className="whitespace-pre-wrap border-t pt-2 text-sm">
            {email.body}
          </p>
        </div>
      </div>
    </div>
  );
}
