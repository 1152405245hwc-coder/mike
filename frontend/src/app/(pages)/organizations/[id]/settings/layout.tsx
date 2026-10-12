"use client";

import { use, type ReactNode } from "react";
import { OrganizationSettingsShell } from "@/app/components/organizations/OrganizationSettingsShell";

export default function OrganizationSettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <OrganizationSettingsShell orgId={id}>{children}</OrganizationSettingsShell>
  );
}
