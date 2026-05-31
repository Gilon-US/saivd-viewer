import {notFound} from "next/navigation";
import {VerifyParityHarness} from "./VerifyParityHarness";

export default function VerifyParityPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <VerifyParityHarness />;
}
