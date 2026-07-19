import { EntryForm } from "../components/EntryForm";
import { useGroup } from "./group";

export default function NewPayment() {
  const { snapshot, me } = useGroup();
  return <EntryForm snapshot={snapshot} kind="payment" me={me} />;
}
