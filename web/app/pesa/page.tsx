import type { Metadata } from "next";
import PesaSimulator from "./PesaSimulator";

export const metadata: Metadata = {
  title: "Pesa Simulator",
  description: "Simulated payment prompt for the demo (not a real payment)",
};

export default function PesaPage() {
  return <PesaSimulator />;
}
