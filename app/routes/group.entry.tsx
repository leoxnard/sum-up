import { useParams } from "react-router";
import { EntryForm } from "../components/EntryForm";
import { PushPanel } from "../components/overlays";
import { useGroup } from "./group";
import { useT } from "../root";

export default function EditEntry() {
  const { snapshot, me } = useGroup();
  const { entryId } = useParams();
  const { t } = useT();
  const entry = snapshot.entries.find((e) => e.id === entryId);
  if (!entry) {
    return (
      <PushPanel backTo={`/g/${snapshot.group.slug}`} title={t.notFound}>
        <p className="text-[var(--text-2)]">{t.groupNotFound}</p>
      </PushPanel>
    );
  }
  return <EntryForm snapshot={snapshot} kind={entry.kind} me={me} entry={entry} />;
}
