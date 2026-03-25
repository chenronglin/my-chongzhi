export const channelsSql = {
  listChannels: `
    SELECT
      id,
      channel_code AS "channelCode",
      channel_name AS "channelName",
      channel_type AS "channelType",
      parent_channel_id AS "parentChannelId",
      status,
      settlement_subject_id AS "settlementSubjectId",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM channel.channels
    ORDER BY created_at DESC
  `,
  listCredentials: `
    SELECT
      id,
      channel_id AS "channelId",
      access_key AS "accessKey",
      secret_key_encrypted AS "secretKeyEncrypted",
      sign_algorithm AS "signAlgorithm",
      status,
      expires_at AS "expiresAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM channel.channel_api_credentials
    ORDER BY created_at DESC
  `,
} as const;
