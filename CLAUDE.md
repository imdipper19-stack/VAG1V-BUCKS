# BAG1V-BUCKS Project

## Available Models (TenetaAI)
| Модель | ID | Описание |
|--------|-----|---------|
| Claude Opus 4.7 | `claude-opus-4-7` | Самая мощная |
| Claude Opus 4.6 | `claude-opus-4-6` | Мощная |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | По умолчанию |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | Быстрая |
| Claude Haiku 4.5 | `claude-haiku-4-5` | Самая быстрая |

## Switching Models
В Claude Code CLI:
```
/model claude-opus-4-7
```
Или при запуске:
```
claude --model claude-opus-4-7
```

## API Configuration
- Base URL: `https://api.tenetauniversity.com` (без /v1)
- API Key: `tenetaai-3X4hD_J_0OL4pgVCe6W2W5c6--Gzz4S2u4eiAsqoi8x`

## Project Structure
- `backend/` - Backend API
- `frontend/` - Frontend application
- `Desing/` - Design files
- `docker-compose.yml` - Docker configuration

## Commands
```bash
npm install     # Install dependencies
npm run dev    # Run development server
docker-compose up  # Run with Docker
```

## Notes
- Node.js 18+ required
- Uses TenetaAI API (Claude Code compatible)
