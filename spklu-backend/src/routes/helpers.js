import { query } from '../db.js';

// Pagination server-side seragam: ?page=1&limit=20 (limit maks 100).
export async function paginate(sql, params, queryParams) {
  const page = Math.max(1, Number(queryParams.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(queryParams.limit) || 20));
  const offset = (page - 1) * limit;

  const countRows = await query(`SELECT COUNT(*) AS n FROM (${sql}) AS sub`, params);
  const rows = await query(`${sql} LIMIT ${limit} OFFSET ${offset}`, params);
  return {
    data: rows,
    page,
    limit,
    total: Number(countRows[0].n),
    totalPages: Math.ceil(Number(countRows[0].n) / limit),
  };
}
