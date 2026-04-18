.PHONY: up down reset seed logs

up:
	docker compose up --build

down:
	docker compose down

reset:
	docker compose down -v && docker compose up --build

seed:
	docker compose exec api pnpm db:seed

logs:
	docker compose logs -f
