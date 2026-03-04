import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { detectPlan, getFreeUsage, PLAN_LABELS, PLAN_LIMITS, type Plan } from "../services/plan.server";

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  const plan      = await detectPlan(billing);
  const freeUsage = plan === "free" ? await getFreeUsage(session.shop) : 0;

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    plan,
    freeUsage,
    freeLimit: PLAN_LIMITS.free.analyses,
  };
};

// ─── Sidebar nav items ────────────────────────────────────────────────────────

interface NavItem {
  href:     string;
  label:    string;
  icon:     string;
  minPlan?: "pro" | "growth";
}

const NAV: NavItem[] = [
  { href: "/app",                label: "Dashboard",         icon: "🏠" },
  { href: "/app/products",       label: "Product Analyzer",  icon: "🔍" },
  { href: "/app/seo-optimizer",  label: "SEO Optimizer",     icon: "📈", minPlan: "pro" },
  { href: "/app/generate",       label: "AI Rewriter",       icon: "✨", minPlan: "pro" },
  { href: "/app/store-health",   label: "Store Health",      icon: "💪" },
  { href: "/app/bulk-analysis",  label: "Bulk Analysis",     icon: "📊", minPlan: "growth" },
  { href: "/app/weekly-report",  label: "Weekly Report",     icon: "📅", minPlan: "growth" },
  { href: "/app/history",        label: "Scan History",      icon: "🕐" },
  { href: "/app/billing",        label: "Plans & Billing",   icon: "💳" },
];

const PLAN_ORDER: Record<Plan, number> = { free: 0, pro: 1, growth: 2 };
function canAccess(plan: Plan, minPlan?: "pro" | "growth") {
  if (!minPlan) return true;
  return PLAN_ORDER[plan] >= PLAN_ORDER[minPlan];
}

// ─── Sidebar CSS ──────────────────────────────────────────────────────────────

const sidebarCss = `
  .aca-layout { display:flex; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .aca-sidebar {
    width:224px; flex-shrink:0;
    background:#fff; border-right:1px solid #e4e5e7;
    display:flex; flex-direction:column;
    position:sticky; top:0; height:100vh; overflow-y:auto;
  }
  .aca-sidebar-logo {
    padding:20px 16px 16px;
    font-size:15px; font-weight:800; color:#1a1d1f;
    border-bottom:1px solid #f1f2f3;
    display:flex; align-items:center; gap:8px;
  }
  .aca-nav-section { padding:8px; flex:1; }
  .aca-nav-label {
    font-size:10px; font-weight:700; color:#8c9196;
    text-transform:uppercase; letter-spacing:0.8px;
    padding:12px 8px 4px;
  }
  .aca-nav-item {
    display:flex; align-items:center; gap:10px;
    padding:9px 10px; border-radius:10px;
    font-size:13px; font-weight:600; color:#1a1d1f;
    text-decoration:none; cursor:pointer;
    transition:all 0.15s; position:relative;
    margin-bottom:2px;
  }
  .aca-nav-item:hover { background:#f4f6f8; color:#1a1d1f; }
  .aca-nav-item.active { background:linear-gradient(135deg,#f0f1ff,#e8eaff); color:#667eea; }
  .aca-nav-item.active .aca-nav-icon { background:#667eea; }
  .aca-nav-icon {
    width:28px; height:28px; border-radius:7px;
    background:#f4f6f8; display:flex; align-items:center;
    justify-content:center; font-size:14px; flex-shrink:0;
    transition:background 0.15s;
  }
  .aca-lock {
    margin-left:auto; font-size:10px; color:#8c9196;
    background:#f4f6f8; padding:2px 6px; border-radius:6px;
    font-weight:700;
  }
  .aca-sidebar-footer {
    padding:12px 16px; border-top:1px solid #f1f2f3;
  }
  .aca-plan-badge {
    display:flex; align-items:center; gap:8px;
    padding:10px 12px; border-radius:10px;
    background:#f8f9fb; font-size:12px;
  }
  .aca-upgrade-btn {
    display:block; text-align:center;
    margin-top:8px; padding:8px;
    border-radius:10px; font-size:12px; font-weight:700;
    text-decoration:none; transition:all 0.15s;
    background:linear-gradient(135deg,#667eea,#764ba2);
    color:white;
  }
  .aca-upgrade-btn:hover { transform:translateY(-1px); color:white; }
  .aca-main { flex:1; min-width:0; overflow-x:hidden; }
`;

// ─── Sidebar component ────────────────────────────────────────────────────────

function Sidebar({ plan, freeUsage, freeLimit }: { plan: Plan; freeUsage: number; freeLimit: number }) {
  const location = useLocation();

  return (
    <aside className="aca-sidebar">
      {/* Logo */}
      <div className="aca-sidebar-logo">
        <span style={{ fontSize: 20 }}>🛍️</span>
        <span>AI Analyzer</span>
      </div>

      {/* Nav */}
      <nav className="aca-nav-section">
        <div className="aca-nav-label">Main</div>
        {NAV.slice(0, 5).map((item) => {
          const locked  = !canAccess(plan, item.minPlan);
          const active  = location.pathname === item.href;
          const lockLabel = item.minPlan === "pro" ? "Pro" : "Growth";

          return locked ? (
            <Link
              key={item.href}
              to="/app/billing"
              className="aca-nav-item"
              style={{ opacity: 0.6 }}
            >
              <span className="aca-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              <span className="aca-lock">🔒 {lockLabel}</span>
            </Link>
          ) : (
            <Link
              key={item.href}
              to={item.href}
              className={`aca-nav-item${active ? " active" : ""}`}
            >
              <span className="aca-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}

        <div className="aca-nav-label" style={{ marginTop: 8 }}>Growth Features</div>
        {NAV.slice(5, 7).map((item) => {
          const locked = !canAccess(plan, item.minPlan);
          const active = location.pathname === item.href;
          return locked ? (
            <Link key={item.href} to="/app/billing" className="aca-nav-item" style={{ opacity: 0.6 }}>
              <span className="aca-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              <span className="aca-lock">🔒 Growth</span>
            </Link>
          ) : (
            <Link key={item.href} to={item.href} className={`aca-nav-item${active ? " active" : ""}`}>
              <span className="aca-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}

        <div className="aca-nav-label" style={{ marginTop: 8 }}>Settings</div>
        {NAV.slice(7).map((item) => {
          const active = location.pathname === item.href;
          return (
            <Link key={item.href} to={item.href} className={`aca-nav-item${active ? " active" : ""}`}>
              <span className="aca-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer — plan info */}
      <div className="aca-sidebar-footer">
        <div className="aca-plan-badge">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#1a1d1f" }}>
              {plan === "free" ? "Free Plan" : plan === "pro" ? "Pro Plan" : "Growth Plan"}
            </div>
            {plan === "free" && (
              <div style={{ fontSize: 11, color: "#6d7175", marginTop: 2 }}>
                {freeUsage}/{freeLimit} analyses used
              </div>
            )}
          </div>
          {plan === "free" && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
              background: "#fff0f0", color: "#c0392b", textTransform: "uppercase",
            }}>FREE</span>
          )}
          {plan === "pro" && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
              background: "#f0f1ff", color: "#667eea", textTransform: "uppercase",
            }}>PRO</span>
          )}
          {plan === "growth" && (
            <span style={{
              fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
              background: "#f0faf5", color: "#008060", textTransform: "uppercase",
            }}>GROWTH</span>
          )}
        </div>

        {/* Free usage bar */}
        {plan === "free" && (
          <div style={{ marginTop: 8 }}>
            <div style={{ height: 4, background: "#f1f2f3", borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 99,
                width: `${Math.min(100, (freeUsage / freeLimit) * 100)}%`,
                background: freeUsage >= freeLimit ? "#c0392b" : "#667eea",
              }} />
            </div>
          </div>
        )}

        {plan !== "growth" && (
          <Link to="/app/billing" className="aca-upgrade-btn">
            {plan === "free" ? "⬆️ Upgrade to Pro" : "⬆️ Upgrade to Growth"}
          </Link>
        )}
      </div>
    </aside>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function App() {
  const { apiKey, plan, freeUsage, freeLimit } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <style>{sidebarCss}</style>
      <div className="aca-layout">
        <Sidebar plan={plan as Plan} freeUsage={freeUsage} freeLimit={freeLimit} />
        <main className="aca-main">
          <Outlet />
        </main>
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
