import { getSession } from "../lib/session";
import Shell from "./Shell";
import { AuthForms, CopyButton } from "./Client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();

  if (!session) {
    return (
      <main className="authwrap">
        <AuthForms />
      </main>
    );
  }

  return (
    <Shell active="home" session={session}>
      <main>
        <section className="hero">
          <img className="logo" src="/logo.jpg" alt="Yedili Network" />
          <h1>
            YEDİLİ<span className="net">NETWORK</span>
          </h1>
          <p className="lead">
            Hoş geldin, {session.realname}! Java ve Bedrock oyuncuları birlikte aynı sunucuda oynayabilir.
          </p>
          <span className="badge">Sürüm: 1.21.5x</span>
        </section>

        <h2 className="title">Nasıl Bağlanılır?</h2>
        <section className="cards">
          <div className="card">
            <h3>Java Edition</h3>
            <div className="row">
              <span>Adres</span>
              <span>yedilinw.mangoohost.live</span>
            </div>
            <CopyButton text="yedilinw.mangoohost.live" />
          </div>
          <div className="card">
            <h3>Bedrock Edition</h3>
            <div className="row">
              <span>Adres</span>
              <span>yedilinw.mangoohost.live</span>
            </div>
            <div className="row">
              <span>Port</span>
              <span>22992</span>
            </div>
            <CopyButton text="yedilinw.mangoohost.live" />
          </div>
        </section>
      </main>
    </Shell>
  );
}
