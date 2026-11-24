import { UserMenu } from "./Client";

export default function Shell({ active, session, children }) {
  return (
    <>
      <header>
        <div className="nav">
          <a className="brand" href="/">
            <img src="/logo.jpg" alt="Yedili Network logo" />
            <span>
              YEDİLİ <b>NETWORK</b>
            </span>
          </a>
          <nav>
            <a className={active === "home" ? "active" : ""} href="/">
              Ana Sayfa
            </a>
            <a className={active === "staff" ? "active" : ""} href="/yetkililer">
              Yetkililer
            </a>
          </nav>
          <UserMenu name={session.realname} />
        </div>
      </header>
      {children}
      <footer>© Yedili Network</footer>
    </>
  );
}
