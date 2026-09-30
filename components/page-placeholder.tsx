import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Temporary shell for routes that are scaffolded but not built yet (CLAUDE.md section 14 build order). */
export function PagePlaceholder({
  title,
  subtitle,
  buildStep,
  items,
}: {
  title: string;
  subtitle?: string;
  buildStep: string;
  items: string[];
}) {
  return (
    <main className="min-h-screen bg-background">
      <header className="bg-brand-800 text-white">
        <div className="container flex h-14 items-center gap-3">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-brand-100 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Roles
          </Link>
          <span className="font-semibold">BranchFlow</span>
        </div>
      </header>
      <div className="container max-w-2xl py-10">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Construction className="h-5 w-5 text-status-amber" />
              <Badge variant="amber">{buildStep}</Badge>
            </div>
            <CardTitle className="mt-2">{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Planned for this screen:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
