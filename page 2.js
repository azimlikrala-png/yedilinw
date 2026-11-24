import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import Shell from "../Shell";

export const dynamic = "force-dynamic";

export default async function Yetkililer() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <Shell active="staff" session={session}>
      <main>
        <h2 className="title" style={{ marginTop: 8 }}>
          Yetkililer
        </h2>
        <section className="staff">
          <div className="card member">
            <div className="avatar">G</div>
            <span className="role kurucu">KURUCU</span>
            <div className="name">geckocraft88117</div>
          </div>
          <div className="card member">
            <div className="avatar">E</div>
            <span className="role admin">ADMİN</span>
            <div className="name">Eren_6331</div>
          </div>
          <div className="card member">
            <div className="avatar">A</div>
            <span className="role gelistirici">GELİŞTİRİCİ</span>
            <div className="name">.alemdeVENOM</div>
          </div>
        </section>
      </main>
    </Shell>
  );
}
