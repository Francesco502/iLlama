import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface ReasoningDisclosureProps {
  text: string;
  streaming: boolean;
}

export function ReasoningDisclosure({ text, streaming }: ReasoningDisclosureProps) {
  const [open, setOpen] = useState(streaming);

  return (
    <section className="reasoning-disclosure">
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <ChevronDown size={13} />
        思考过程{streaming ? " · 生成中" : ""}
      </button>
      {open && <div className="reasoning-content">{text}</div>}
    </section>
  );
}
