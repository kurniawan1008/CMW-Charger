-- Index hasil audit performa (M7) — jalankan sekali setelah schema-delta.sql
USE spklu_db;
ALTER TABLE transaction_logs ADD KEY idx_logs_session (session_id);
ALTER TABLE sessions ADD KEY idx_sessions_channel_status (channel_id, status);
ALTER TABLE channels ADD KEY idx_channels_current_session (current_session_id);
