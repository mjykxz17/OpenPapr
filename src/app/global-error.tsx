"use client";

// Last resort when the root layout itself fails: no app styles are loaded
// here, so it is styled inline.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fcfcfc", color: "#18181b" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>OpenPapr could not load</h1>
            <p style={{ fontSize: 14, color: "#52525b", lineHeight: 1.6 }}>Something went wrong on our side. Please try again in a moment.</p>
            <button type="button" onClick={reset} style={{ height: 40, padding: "0 16px", borderRadius: 6, border: 0, background: "#0f766e", color: "#fff", fontSize: 14, cursor: "pointer" }}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
