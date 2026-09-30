import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  CreditCard,
  FileCheck,
  FileSignature,
  HeartPulse,
  Landmark,
  MapPinHouse,
  MessageSquareWarning,
  Notebook,
  PiggyBank,
  ScrollText,
  UserCheck,
  UserPlus,
  Users,
  Vault,
  Wallet,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight, Banknote, BookOpen, CreditCard, FileCheck, FileSignature, HeartPulse, Landmark, MapPinHouse,
  MessageSquareWarning, Notebook, PiggyBank, ScrollText, UserCheck, UserPlus, Users, Vault, Wallet,
};

export function ServiceIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? FileCheck;
  return <Icon className={className} />;
}
