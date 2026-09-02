import { Link } from "react-router";

import { useT } from "../root";

/**
 * Impressum and privacy policy.
 *
 * German law wants this one click away from every page, so it deliberately
 * lives outside the group shell: no slug, no snapshot, nothing to load. That
 * also means it renders offline like any other cached page.
 *
 * The text is in the dictionaries rather than here, so both languages stay in
 * step — a legal page that says different things in DE and EN is worse than no
 * translation at all.
 */
export function meta() {
  return [{ title: "Sum Up" }, { name: "robots", content: "noindex" }];
}

export default function Legal() {
  const { t } = useT();

  const imprint = [{ title: t.legalHostingTitle, body: t.legalHosting }];

  const privacy = [
    { title: t.legalControllerTitle, body: t.legalController },
    { title: t.legalDataTitle, body: t.legalData },
    { title: t.legalPurposeTitle, body: t.legalPurpose },
    { title: t.legalThirdPartiesTitle, body: t.legalThirdParties },
    { title: t.legalRetentionTitle, body: t.legalRetention },
    { title: t.legalAnalyticsTitle, body: t.legalAnalytics },
    { title: t.legalCookiesTitle, body: t.legalCookies },
    { title: t.legalRightsTitle, body: t.legalRights },
    { title: t.legalLiabilityTitle, body: t.legalLiability },
  ];

  return (
    <main className="animate-rise mx-auto max-w-md px-4 pb-16 pt-12">
      <h1 className="text-2xl font-bold tracking-tight">{t.legal}</h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">{t.legalAddressTitle}</h2>
        <p className="mt-1 text-sm text-[var(--text-2)]">
          {t.legalName}
          <br />
          {t.legalStreet}
          <br />
          {t.legalCity}
          <br />
          {t.legalCountry}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">{t.legalContactTitle}</h2>
        <p className="mt-1 text-sm text-[var(--text-2)]">
          <a href={`mailto:${t.legalEmail}`} className="underline">
            {t.legalEmail}
          </a>
        </p>
      </section>

      {imprint.map((section) => (
        <Section key={section.title} title={section.title} body={section.body} />
      ))}

      <h2 className="mt-12 text-2xl font-bold tracking-tight">{t.legalPrivacy}</h2>

      {privacy.map((section) => (
        <Section key={section.title} title={section.title} body={section.body} />
      ))}

      <p className="mt-10 text-xs text-[var(--text-3)]">{t.legalUpdated}</p>

      <Link to="/" className="btn btn-outline mt-6">
        {t.backHome}
      </Link>
    </main>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--text-2)]">{body}</p>
    </section>
  );
}
