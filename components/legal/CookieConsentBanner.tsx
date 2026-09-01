"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ModalPortal } from "@/components/ui/modal-portal";
import { readCookieConsent, writeCookieConsent } from "@/lib/legal/cookie-consent";

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [analyticsToggle, setAnalyticsToggle] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("1.0");

  useEffect(() => {
    async function check() {
      let version = "1.0";
      try {
        const res = await fetch("/api/legal/cookie-version");
        const data = (await res.json()) as { version?: string };
        version = data.version ?? "1.0";
      } catch {
        // silent fallback la versiunea default
      }
      setCurrentVersion(version);

      const existing = readCookieConsent();
      if (!existing || existing.version !== version) {
        setVisible(true);
      }
    }
    void check();
  }, []);

  async function persist(analytics: boolean) {
    writeCookieConsent({
      analytics,
      version: currentVersion,
      decidedAt: new Date().toISOString(),
    });

    // Fire-and-forget consent write for authenticated users.
    // Anonymous users get 401 here (handled silently); their consent will be
    // migrated by lib/legal/consent-migration on next login.
    void (async () => {
      try {
        const res = await fetch("/api/legal/accept-pending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documents: [{ type: "cookies", version: currentVersion }],
          }),
        });
        if (!res.ok && res.status !== 401 && res.status !== 207) {
          console.error("[CookieConsentBanner] Consent write failed:", res.status);
        }
      } catch (err) {
        console.error("[CookieConsentBanner] Consent write threw:", err);
      }
    })();

    setVisible(false);
    setPreferencesOpen(false);
  }

  if (!visible) return null;

  return (
    <>
      {/*
        Banner bottom sheet. Pe mobil, BottomTabBar plutește la z-[130] deasupra
        acestui banner (z-50); padding-ul de jos ține butoanele deasupra barei, în loc
        să ridice tot banner-ul — bara e ascunsă pe multe rute, iar un offset fix ar
        lăsa acolo un gol.
      */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 p-4 pb-[calc(1rem+var(--mobile-nav-height)+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:p-6 md:pb-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            Folosim cookie-uri strict necesare pentru autentificare și, opțional,
            analiză agregată fără cookie-uri (Vercel Analytics). Poți alege ce
            accepți.{" "}
            <Link href="/legal/cookies" className="underline underline-offset-4">
              Detalii
            </Link>
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              className="flex-1 md:flex-none"
              onClick={() => persist(false)}
            >
              Respinge
            </Button>
            <Button
              variant="outline"
              className="flex-1 md:flex-none"
              onClick={() => setPreferencesOpen(true)}
            >
              Preferințe
            </Button>
            <Button
              variant="outline"
              className="flex-1 md:flex-none"
              onClick={() => persist(true)}
            >
              Acceptă tot
            </Button>
          </div>
        </div>
      </div>

      {/* Preferences modal */}
      {preferencesOpen && (
        <ModalPortal>
          {/* Peste BottomTabBar (z-[130]), altfel bara plutește peste overlay. */}
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
            onClick={() => setPreferencesOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="mb-4 text-lg font-semibold text-foreground">
                Preferințe cookie-uri
              </h2>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                  <div>
                    <p className="font-medium text-foreground">Strict necesare</p>
                    <p className="text-sm text-muted-foreground">
                      Autentificare și sesiune (Supabase). Nu pot fi dezactivate.
                    </p>
                  </div>
                  <Switch checked disabled className="mt-0.5 shrink-0" />
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
                  <div>
                    <p className="font-medium text-foreground">Analiză</p>
                    <p className="text-sm text-muted-foreground">
                      Vercel Analytics, fără cookie-uri, date agregate anonime.
                    </p>
                  </div>
                  <Switch
                    checked={analyticsToggle}
                    onCheckedChange={setAnalyticsToggle}
                    className="mt-0.5 shrink-0"
                  />
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => persist(false)}
                >
                  Respinge tot
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => persist(analyticsToggle)}
                >
                  Salvează
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
