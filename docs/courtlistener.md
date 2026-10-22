# CourtListener integration

Mike can use CourtListener for US case-law citation verification, case fetching,
targeted opinion search, and case-law panels in assistant responses.

## Enable live access

CourtListener is a connector. Each user adds it from **Settings > Connectors >
Discover > CourtListener** by saving their own API token; Mike stores it
encrypted in the database with the user's other keys. An organization can hold
a token for its members instead. There is no deployment-wide token:
`COURTLISTENER_API_TOKEN` is no longer read from `backend/.env`.

Once added, CourtListener appears under **Installed**. Its switch turns case-law
research on or off, and **Manage** replaces or deletes the token. The assistant
is given the CourtListener tools only while the switch is on and the connector
is installed. Unlike the other connections under **Installed**, it is not
limited to the Personal workspace: the assistant can use it in assistant and
project chats in every workspace. Tabular review and the Word add-in do not
offer it.

Fresh databases created from `backend/schema.sql` already include the required
CourtListener tables. Existing deployments must apply the matching dated
migration from `backend/migrations/` before enabling the integration.

Live requests remain subject to CourtListener's API limits.

## Optional bulk data

Set `COURTLISTENER_BULK_DATA_ENABLED=true` to make Mike try local Supabase and
R2 data before falling back to CourtListener's API. CourtListener is then
installed for every user without a token, and its **Manage** dialog reads
"Bulk data installed and in use". A user's own token still adds the live API
fallback and opinion search:

- Citation metadata is read from `public.courtlistener_citation_index`.
- Case-cluster metadata is read from
  `public.courtlistener_opinion_cluster_index`.
- Cached opinion JSON is read from
  `courtlistener/opinions/by-cluster/{clusterId}/{opinionId}.json` in R2.

If bulk data has not been imported, leave
`COURTLISTENER_BULK_DATA_ENABLED=false`. Live CourtListener tools still work
with a user's or organization's token.

## Troubleshooting

If tools report a missing token, add CourtListener with a token under
**Settings > Connectors**. A token in `backend/.env` is ignored.

If bulk lookup does not return local results, confirm that:

- `COURTLISTENER_BULK_DATA_ENABLED=true`;
- both CourtListener index tables contain data; and
- opinion JSON exists beneath `courtlistener/opinions/by-cluster/` in R2.

Mike falls back to the live API when local bulk data is unavailable and the
user or their organization has saved a token.
