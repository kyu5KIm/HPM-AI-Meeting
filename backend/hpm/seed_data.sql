-- HPM 초기 데이터 설정 (PostgreSQL / Supabase)
-- 실행 전: python manage.py migrate 완료 후 실행

-- 기존 데이터 초기화 (users를 참조하는 데이터도 함께 삭제됨)
TRUNCATE TABLE users, "rank", dept RESTART IDENTITY CASCADE;

-- ─────────────────────────────────────────────
-- 1. 부서 (dept)
-- ─────────────────────────────────────────────
INSERT INTO dept (dept_id, dept_name) VALUES
(1, '개발팀'),
(2, '인프라팀'),
(3, 'QA팀'),
(4, '데이터팀'),
(5, '보안팀');

-- ─────────────────────────────────────────────
-- 2. 직급 (rank)
-- ─────────────────────────────────────────────
INSERT INTO "rank" (rank_id, rank_name) VALUES
(1, '대표이사'),
(2, '이사'),
(3, '부장'),
(4, '차장'),
(5, '과장'),
(6, '대리'),
(7, '주임'),
(8, '사원');

-- ─────────────────────────────────────────────
-- 3. 사용자 (users)
-- password = 'abc123' (DEFAULT_USER_PASSWORD)
-- account_status: 0=정상 / status: 0=재직
-- role: ADMIN or USER
-- ─────────────────────────────────────────────

-- 관리자
INSERT INTO users (dept_id, rank_id, emp_no, email, name, work, password, account_status, status, role, created_at, updated_at) VALUES
(1, 1, 'EMP000', 'admin@hpm.com', '관리자', '시스템 관리', 'abc123', 0, 0, 'ADMIN', NOW(), NOW());

-- ── 개발팀 ──────────────────────────────────
INSERT INTO users (dept_id, rank_id, emp_no, email, name, work, password, account_status, status, role, created_at, updated_at) VALUES
(1, 3, 'EMP001', 'kim.dev@hpm.com',   '김현수', '백엔드 개발',      'abc123', 0, 0, 'USER', NOW(), NOW()),
(1, 4, 'EMP002', 'lee.dev@hpm.com',   '이지원', '프론트엔드 개발',  'abc123', 0, 0, 'USER', NOW(), NOW()),
(1, 6, 'EMP003', 'park.dev@hpm.com',  '박민준', '풀스택 개발',      'abc123', 0, 0, 'USER', NOW(), NOW()),
(1, 7, 'EMP004', 'choi.dev@hpm.com',  '최유나', 'API 설계 및 개발', 'abc123', 0, 0, 'USER', NOW(), NOW()),
(1, 8, 'EMP005', 'jung.dev@hpm.com',  '정다은', '백엔드 개발',      'abc123', 0, 0, 'USER', NOW(), NOW());

-- ── 인프라팀 ─────────────────────────────────
INSERT INTO users (dept_id, rank_id, emp_no, email, name, work, password, account_status, status, role, created_at, updated_at) VALUES
(2, 4, 'EMP011', 'jung.infra@hpm.com', '정태양', '서버 운영 및 관리',      'abc123', 0, 0, 'USER', NOW(), NOW()),
(2, 5, 'EMP012', 'han.infra@hpm.com',  '한소희', '클라우드 인프라 구축',   'abc123', 0, 0, 'USER', NOW(), NOW()),
(2, 6, 'EMP013', 'yun.infra@hpm.com',  '윤재혁', 'DevOps 엔지니어링',     'abc123', 0, 0, 'USER', NOW(), NOW()),
(2, 8, 'EMP014', 'lim.infra@hpm.com',  '임서준', '네트워크 관리',          'abc123', 0, 0, 'USER', NOW(), NOW());

-- ── QA팀 ─────────────────────────────────────
INSERT INTO users (dept_id, rank_id, emp_no, email, name, work, password, account_status, status, role, created_at, updated_at) VALUES
(3, 5, 'EMP021', 'kang.qa@hpm.com',  '강민서', '테스트 케이스 설계', 'abc123', 0, 0, 'USER', NOW(), NOW()),
(3, 6, 'EMP022', 'im.qa@hpm.com',    '임채원', '자동화 테스트',      'abc123', 0, 0, 'USER', NOW(), NOW()),
(3, 7, 'EMP023', 'song.qa@hpm.com',  '송지아', '품질 관리',          'abc123', 0, 0, 'USER', NOW(), NOW()),
(3, 8, 'EMP024', 'oh.qa@hpm.com',    '오수민', '버그 트래킹',        'abc123', 0, 0, 'USER', NOW(), NOW());

-- ── 데이터팀 ─────────────────────────────────
INSERT INTO users (dept_id, rank_id, emp_no, email, name, work, password, account_status, status, role, created_at, updated_at) VALUES
(4, 4, 'EMP031', 'oh.data@hpm.com',   '오준혁', '데이터 파이프라인 구축', 'abc123', 0, 0, 'USER', NOW(), NOW()),
(4, 5, 'EMP032', 'bae.data@hpm.com',  '배수빈', '데이터 분석',            'abc123', 0, 0, 'USER', NOW(), NOW()),
(4, 6, 'EMP033', 'shin.data@hpm.com', '신예진', 'ML 모델 개발',           'abc123', 0, 0, 'USER', NOW(), NOW()),
(4, 7, 'EMP034', 'ko.data@hpm.com',   '고태민', '데이터 엔지니어링',      'abc123', 0, 0, 'USER', NOW(), NOW());

-- ── 보안팀 ─────────────────────────────────────
INSERT INTO users (dept_id, rank_id, emp_no, email, name, work, password, account_status, status, role, created_at, updated_at) VALUES
(5, 3, 'EMP041', 'jo.sec@hpm.com',   '조성현', '보안 정책 수립',    'abc123', 0, 0, 'USER', NOW(), NOW()),
(5, 5, 'EMP042', 'ryu.sec@hpm.com',  '류지우', '보안 취약점 분석',  'abc123', 0, 0, 'USER', NOW(), NOW()),
(5, 6, 'EMP043', 'moon.sec@hpm.com', '문하늘', '침해사고 대응',     'abc123', 0, 0, 'USER', NOW(), NOW()),
(5, 7, 'EMP044', 'yoo.sec@hpm.com',  '유승호', '코드 보안 검토',    'abc123', 0, 0, 'USER', NOW(), NOW());

-- 고정 ID로 넣은 테이블의 시퀀스를 현재 최대값으로 맞춤
SELECT setval(pg_get_serial_sequence('dept', 'dept_id'), (SELECT MAX(dept_id) FROM dept));
SELECT setval(pg_get_serial_sequence('"rank"', 'rank_id'), (SELECT MAX(rank_id) FROM "rank"));
