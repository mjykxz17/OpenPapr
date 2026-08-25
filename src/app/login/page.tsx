import { LoginForm } from "@/components/LoginForm";

// Rendered per request, not at build time: the Canvas URL comes from the
// runtime environment, and the image is built without any secrets present.
// Read the one variable directly rather than via loadEnv(), so displaying a
// sign-in form does not require SECRET_KEY and APP_PASSWORD to be validated.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL ?? "https://canvas.nus.edu.sg";
  return (
    <div className="flex min-h-svh items-center justify-center bg-surface px-6">
      <div className="w-full max-w-sm border border-line p-8">
        <h1 className="mb-1 text-base font-medium text-ink">OpenPapr</h1>
        <p className="mb-6 text-sm text-ink-3">
          Sign in with your invite code and your own Canvas token. Your courses,
          deadlines and notes stay yours.
        </p>
        <LoginForm canvasBaseUrl={CANVAS_BASE_URL} />
      </div>
    </div>
  );
}
