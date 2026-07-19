import { EntryForm } from "../components/EntryForm";
import { useGroup } from "./group";

export default function NewExpense() {
  const { snapshot, me } = useGroup();
  return <EntryForm snapshot={snapshot} kind="expense" me={me} />;
}
