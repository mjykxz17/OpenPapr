import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-surface px-6">
      <div className="w-full max-w-sm border border-line p-8">
        <h1 className="mb-1 text-base font-medium text-ink">OpenPapr</h1>
        <p className="mb-6 text-sm text-ink-3">Sign in to continue.</p>
        <LoginForm />
      </div>
    </div>
  );
}
