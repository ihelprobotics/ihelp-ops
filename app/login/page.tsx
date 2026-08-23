import { signIn } from "@/auth";

export default function Login() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh",
                   background: "#0E1620", color: "#DCE6ED",
                   fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>iHelp Ops</h1>
        <p style={{ color: "#78909F", fontSize: 13, marginBottom: 22 }}>
          Sign in with your work Google account.
        </p>
        <form action={async () => { "use server"; await signIn("google", { redirectTo: "/" }); }}>
          <button style={{ background: "#4FD1C5", color: "#06231F", border: 0,
                           borderRadius: 3, padding: "10px 20px", fontWeight: 600,
                           fontSize: 13, cursor: "pointer" }}>
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
