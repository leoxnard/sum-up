import { useParams } from "react-router";
import { EntryForm } from "../components/EntryForm";
import { useGroup } from "./group";
import { useT } from "../root";

export default function EditEntry() {
  const { snapshot, me } = useGroup();
  const { entryId } = useParams();
  const { t } = useT();
  const entry = snapshot.entries.find((e) => e.id === entryId);
  if (!entry) {
    return <main className="px-4 pt-16 text-center text-neutral-500">{t.notFound}</main>;
  }
  return <EntryForm snapshot={snapshot} kind={entry.kind} me={me} entry={entry} />;
}
