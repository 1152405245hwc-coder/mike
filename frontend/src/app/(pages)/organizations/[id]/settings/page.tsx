"use client";

import { use } from "react";
import { OrganizationSettings } from "@/app/components/organizations/OrganizationSettings";

export default function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <OrganizationSettings orgId={id} />;
}
