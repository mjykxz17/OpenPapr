import { LoginForm } from "@/components/LoginForm";
import { loadEnv } from "@/lib/env";

export default function LoginPage() {
  const { CANVAS_BASE_URL } = loadEnv();
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
