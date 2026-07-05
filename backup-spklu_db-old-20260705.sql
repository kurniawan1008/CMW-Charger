-- MariaDB dump 10.19  Distrib 10.4.32-MariaDB, for Win64 (AMD64)
--
-- Host: localhost    Database: spklu_db
-- ------------------------------------------------------
-- Server version	10.4.32-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `channels`
--

DROP TABLE IF EXISTS `channels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `channels` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `station_id` int(11) DEFAULT NULL,
  `device_id` int(11) DEFAULT NULL,
  `device_ch` tinyint(4) DEFAULT NULL,
  `status` enum('READY','CHARGING','OFFLINE') NOT NULL DEFAULT 'READY',
  `current_user_id` int(11) DEFAULT NULL,
  `current_session_id` varchar(40) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_channel_device_ch` (`device_id`,`device_ch`),
  KEY `fk_channel_user` (`current_user_id`),
  KEY `idx_channels_station` (`station_id`),
  KEY `idx_channels_device` (`device_id`),
  CONSTRAINT `fk_channel_device` FOREIGN KEY (`device_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_channel_station` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_channel_user` FOREIGN KEY (`current_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `channels`
--

LOCK TABLES `channels` WRITE;
/*!40000 ALTER TABLE `channels` DISABLE KEYS */;
INSERT INTO `channels` VALUES (1,1,1,1,'READY',NULL,NULL,'2026-06-24 13:24:16'),(2,1,1,2,'READY',NULL,NULL,'2026-06-24 13:24:16'),(3,1,1,3,'READY',NULL,NULL,'2026-06-24 13:24:16');
/*!40000 ALTER TABLE `channels` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `devices`
--

DROP TABLE IF EXISTS `devices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `devices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `device_key` varchar(80) NOT NULL,
  `name` varchar(120) NOT NULL,
  `station_id` int(11) DEFAULT NULL,
  `mode` enum('ONLINE','OFFLINE') NOT NULL DEFAULT 'OFFLINE',
  `online` tinyint(1) NOT NULL DEFAULT 0,
  `last_seen_at` timestamp NULL DEFAULT NULL,
  `fw_info` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `device_key` (`device_key`),
  KEY `idx_devices_station` (`station_id`),
  CONSTRAINT `fk_device_station` FOREIGN KEY (`station_id`) REFERENCES `stations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `devices`
--

LOCK TABLES `devices` WRITE;
/*!40000 ALTER TABLE `devices` DISABLE KEYS */;
INSERT INTO `devices` VALUES (1,'QvhNCmSk31DT0M7upEnGHRyY6a28eI5sXcjxtKPA','CMW Charger #01 (XY12550S)',1,'OFFLINE',0,'2026-06-26 00:48:33',NULL,'2026-06-25 07:46:20'),(3,'CHANGE_ME_DEVICE_KEY','CMW Charger #01 (XY12550S)',1,'OFFLINE',0,NULL,NULL,'2026-07-05 00:35:39');
/*!40000 ALTER TABLE `devices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sessions` (
  `id` varchar(40) NOT NULL,
  `user_id` int(11) NOT NULL,
  `channel_id` int(11) NOT NULL,
  `start_mode` enum('NOMINAL','KWH') NOT NULL DEFAULT 'NOMINAL',
  `target_kwh` decimal(10,4) NOT NULL DEFAULT 0.0000,
  `reserved_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `is_simulated` tinyint(1) NOT NULL DEFAULT 0,
  `consumed_kwh` decimal(10,4) NOT NULL DEFAULT 0.0000,
  `kwh_source` enum('DEVICE','FALLBACK','SIM') DEFAULT NULL,
  `total_cost` decimal(14,2) DEFAULT NULL,
  `status` enum('ACTIVE','COMPLETED','STOPPED') NOT NULL DEFAULT 'ACTIVE',
  `start_time` timestamp NOT NULL DEFAULT current_timestamp(),
  `end_time` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sessions_user` (`user_id`),
  KEY `idx_sessions_status` (`status`),
  KEY `fk_session_channel` (`channel_id`),
  KEY `idx_sessions_channel_status` (`channel_id`,`status`),
  CONSTRAINT `fk_session_channel` FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sessions`
--

LOCK TABLES `sessions` WRITE;
/*!40000 ALTER TABLE `sessions` DISABLE KEYS */;
INSERT INTO `sessions` VALUES ('SESS-1782308424609',1,1,'NOMINAL',2.0492,0.00,0,1.3200,NULL,3220.80,'STOPPED','2026-06-24 13:40:24','2026-06-24 13:40:58'),('SESS-1782308869791',3,3,'NOMINAL',2.0492,0.00,0,1.1200,NULL,2732.80,'STOPPED','2026-06-24 13:47:49','2026-06-24 13:48:18'),('SESS-1782311827347',1,1,'NOMINAL',2.0492,0.00,0,2.0492,NULL,5000.05,'COMPLETED','2026-06-24 14:37:07','2026-06-24 14:37:59'),('SESS-1782434910491',1,1,'KWH',1.0000,0.00,0,1.0000,NULL,2440.00,'COMPLETED','2026-06-26 00:48:30','2026-06-26 00:48:30');
/*!40000 ALTER TABLE `sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `stations`
--

DROP TABLE IF EXISTS `stations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `address` varchar(255) NOT NULL,
  `city` varchar(100) NOT NULL,
  `lat` decimal(10,7) NOT NULL,
  `lng` decimal(10,7) NOT NULL,
  `status` enum('ONLINE','BUSY','OFFLINE') NOT NULL DEFAULT 'ONLINE',
  `connectors` int(11) NOT NULL DEFAULT 2,
  `available` int(11) NOT NULL DEFAULT 0,
  `power_kw` int(11) NOT NULL DEFAULT 60,
  `type` enum('DC','AC','DC/AC') NOT NULL DEFAULT 'DC',
  `hours` varchar(60) NOT NULL DEFAULT '24 Jam',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_stations_city` (`city`),
  KEY `idx_stations_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `stations`
--

LOCK TABLES `stations` WRITE;
/*!40000 ALTER TABLE `stations` DISABLE KEYS */;
INSERT INTO `stations` VALUES (1,'CMW SPKLU Sudirman Hub','Jl. Jenderal Sudirman Kav. 52-53, Senayan','Jakarta Selatan',-6.2249350,106.8092040,'ONLINE',6,4,7,'DC','24 Jam','2026-06-24 14:55:47','2026-06-25 01:35:48'),(2,'CMW SPKLU Kelapa Gading','Jl. Boulevard Raya Blok M, Kelapa Gading Barat','Jakarta Utara',-6.1578350,106.9072040,'BUSY',3,0,7,'DC','24 Jam','2026-06-24 14:55:47','2026-06-25 02:19:15'),(3,'CMW SPKLU BSD Green Office Park','Jl. BSD Grand Boulevard, BSD City, Sampora','Tangerang Selatan',-6.3015200,106.6501690,'ONLINE',6,3,7,'DC','24 Jam','2026-06-24 14:55:47','2026-06-25 02:19:06'),(4,'CMW SPKLU Bekasi Summarecon','Jl. Bulevar Selatan, Marga Mulya, Bekasi Utara','Bekasi',-6.2215400,107.0016200,'OFFLINE',3,3,7,'DC','24 Jam','2026-06-24 14:55:47','2026-06-25 01:34:12'),(5,'CMW SPKLU Bogor Pajajaran','Jl. Raya Pajajaran No. 88, Baranangsiang','Bogor',-6.6013890,106.8064580,'ONLINE',3,2,7,'DC','24 Jam','2026-06-24 14:55:47','2026-06-25 01:34:43'),(6,'CMW SPKLU Bandung Dago','Jl. Ir. H. Djuanda No. 165, Dago, Coblong','Bandung',-6.8847870,107.6131440,'ONLINE',3,3,7,'DC','24 Jam','2026-06-24 14:55:47','2026-06-25 01:32:18'),(7,'CMW SPKLU Bandung Pasteur','Jl. Dr. Djunjunan No. 143-149, Sukabungah','Bandung',-6.8937030,107.5780180,'ONLINE',3,3,7,'DC','24 Jam','2026-06-24 14:55:47','2026-06-25 01:32:47'),(8,'CMW SPKLU Surabaya Pakuwon','Jl. Mayjen Jonosewojo, Babatan, Wiyung','Surabaya',-7.3011400,112.6744690,'ONLINE',6,5,7,'DC','24 Jam','2026-06-24 14:55:47','2026-06-25 01:35:25'),(17,'CMW SPKLU Sudirman Hub','Jl. Jenderal Sudirman Kav. 52-53, Senayan','Jakarta Selatan',-6.2249350,106.8092040,'ONLINE',6,4,200,'DC/AC','24 Jam','2026-07-05 00:35:39','2026-07-05 00:35:39'),(18,'CMW SPKLU Kelapa Gading','Jl. Boulevard Raya Blok M, Kelapa Gading Barat','Jakarta Utara',-6.1578350,106.9072040,'BUSY',4,0,150,'DC','24 Jam','2026-07-05 00:35:39','2026-07-05 00:35:39'),(19,'CMW SPKLU BSD Green Office Park','Jl. BSD Grand Boulevard, BSD City, Sampora','Tangerang Selatan',-6.3015200,106.6501690,'ONLINE',5,3,120,'DC/AC','06.00 - 23.00','2026-07-05 00:35:39','2026-07-05 00:35:39'),(20,'CMW SPKLU Bekasi Summarecon','Jl. Bulevar Selatan, Marga Mulya, Bekasi Utara','Bekasi',-6.2215400,107.0016200,'OFFLINE',2,0,60,'AC','06.00 - 22.00','2026-07-05 00:35:39','2026-07-05 00:35:39'),(21,'CMW SPKLU Bogor Pajajaran','Jl. Raya Pajajaran No. 88, Baranangsiang','Bogor',-6.6013890,106.8064580,'ONLINE',3,2,120,'DC','24 Jam','2026-07-05 00:35:39','2026-07-05 00:35:39'),(22,'CMW SPKLU Bandung Dago','Jl. Ir. H. Djuanda No. 165, Dago, Coblong','Bandung',-6.8847870,107.6131440,'BUSY',4,1,150,'DC/AC','24 Jam','2026-07-05 00:35:39','2026-07-05 00:35:39'),(23,'CMW SPKLU Bandung Pasteur','Jl. Dr. Djunjunan No. 143-149, Sukabungah','Bandung',-6.8937030,107.5780180,'ONLINE',2,2,60,'AC','07.00 - 21.00','2026-07-05 00:35:39','2026-07-05 00:35:39'),(24,'CMW SPKLU Surabaya Pakuwon','Jl. Mayjen Jonosewojo, Babatan, Wiyung','Surabaya',-7.3011400,112.6744690,'ONLINE',6,5,200,'DC/AC','24 Jam','2026-07-05 00:35:39','2026-07-05 00:35:39');
/*!40000 ALTER TABLE `stations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `topup_requests`
--

DROP TABLE IF EXISTS `topup_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `topup_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `decided_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_topupreq_status` (`status`),
  KEY `fk_topupreq_user` (`user_id`),
  CONSTRAINT `fk_topupreq_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `topup_requests`
--

LOCK TABLES `topup_requests` WRITE;
/*!40000 ALTER TABLE `topup_requests` DISABLE KEYS */;
INSERT INTO `topup_requests` VALUES (1,1,100000.00,'APPROVED','2026-06-24 13:35:44','2026-06-24 13:39:00'),(2,3,50000.00,'APPROVED','2026-06-24 13:44:53','2026-06-24 13:47:19');
/*!40000 ALTER TABLE `topup_requests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `transaction_logs`
--

DROP TABLE IF EXISTS `transaction_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `transaction_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `type` enum('TOPUP','CHARGING_FEE') NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_logs_user` (`user_id`),
  KEY `idx_logs_type` (`type`),
  KEY `idx_logs_created` (`created_at`),
  CONSTRAINT `fk_log_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transaction_logs`
--

LOCK TABLES `transaction_logs` WRITE;
/*!40000 ALTER TABLE `transaction_logs` DISABLE KEYS */;
INSERT INTO `transaction_logs` VALUES (1,1,100000.00,'TOPUP','Top up saldo','2026-06-24 13:39:00'),(2,1,3220.80,'CHARGING_FEE','CH-01 · 1.3 kWh','2026-06-24 13:40:58'),(3,3,50000.00,'TOPUP','Top up saldo','2026-06-24 13:47:19'),(4,3,2732.80,'CHARGING_FEE','CH-03 · 1.1 kWh','2026-06-24 13:48:18'),(5,3,100000.00,'TOPUP','Top up via dashboard admin','2026-06-24 13:52:40'),(6,1,5000.05,'CHARGING_FEE','CH-01 · 2.0 kWh','2026-06-24 14:37:59'),(8,1,2440.00,'CHARGING_FEE','CH-01 · 1.0 kWh','2026-06-26 00:48:30');
/*!40000 ALTER TABLE `transaction_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(190) NOT NULL,
  `password` varchar(255) NOT NULL,
  `full_name` varchar(150) NOT NULL,
  `username` varchar(80) NOT NULL,
  `npk` varchar(60) DEFAULT NULL,
  `phone` varchar(40) DEFAULT NULL,
  `balance` decimal(14,2) NOT NULL DEFAULT 0.00,
  `role` enum('USER','ADMIN') NOT NULL DEFAULT 'USER',
  `status` enum('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'iwan.av1998@gmail.com','$2b$10$m2Xo3egX1je/wjd61v2gWudWw91vlWZSWqfDw7.5TtixJPQhUi9Ei','Muhammad Kurniawan','kurniawan22','08730','085279360042',89339.15,'USER','ACTIVE','2026-06-24 13:34:28'),(2,'rd@cmw.co.id','$2b$10$ZAhGmbNPjwZQK/TFYRp6WuCNscu578ayTbuZcvGnBtGD5qw8F3Gtm','R&D Admin','rd@cmw.co.id','12345','085279360042',0.00,'ADMIN','ACTIVE','2026-06-24 13:36:56'),(3,'WidiaAP@gmail.com','$2b$10$sSY7/WGIsEdl7bknZnDV9uJ.wxLXq7WH5DySAAXpPSNhFZ3shPtLi','Widia Anggi Palupi','WidiaAP@gmail.com','08731','085279360042',147267.20,'USER','ACTIVE','2026-06-24 13:42:53');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-05  7:39:12
