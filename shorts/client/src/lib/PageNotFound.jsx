import { useLocation } from "react-router-dom";

export default function PageNotFound() {
  const location = useLocation();
  const pageName = location.pathname.substring(1);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="font-mono text-7xl text-line">404</h1>
        <h2 className="text-2xl font-medium tracking-tight text-ink">
          Page Not Found
        </h2>
        <p className="text-fog">
          The page &quot;{pageName}&quot; could not be found.
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/";
          }}
          className="btn-pill-secondary"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
