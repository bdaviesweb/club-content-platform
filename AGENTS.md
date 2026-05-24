# Club Content Platform

This workspace is the local Codex project for `Club Content Platform`.

## Project Description

Mobile-first club content workflow platform for parents, players, coaches, and admins, with AI review, approval routing, publishing, and iOS beta distribution.

## Product Direction

- This repo is for the club content and publishing workflow product.
- It is not the separate sports weather project.
- Keep social/content workflow naming and behavior intact unless explicitly told to pivot.

## Current Architecture

- `apps/mobile` - Expo / React Native app for submissions and status
- `apps/admin-web` - admin review and approval console
- `apps/app-api` - backend API for uploads, submissions, approvals, and support/privacy pages
- `apps/worker` - background workflow runner for moderation, routing, and publishing
- `packages/shared` - shared events and constants
- `db` - schema and seed material

## Working Flow

1. Mobile client requests presigned upload URLs
2. Mobile client uploads media
3. Mobile client creates a submission
4. Worker reviews and routes the submission
5. Admin approves or rejects
6. System publishes internally

## Important Environment Notes

- Local API: `http://localhost:4000`
- Local admin UI: `http://localhost:3001`
- Public API host: `https://clubcontent-api.davmn.net`
- Public uploads host: `https://clubcontent-uploads.davmn.net`

## Important Mobile Identity

- Expo/EAS project: `@clubhqpro/club-content`
- EAS project ID: `83871f8c-a185-47d5-8f19-5e2749dc81d2`
- iOS bundle ID: `com.hermes.clubcontent`

Do not rewire this repo to the weather app identity.

## Useful Commands

- `docker compose up --build`
- `npm --workspace @club/app-api run dev`
- `npm --workspace @club/admin-web run dev`
- `npm --workspace @club/worker run dev`
- `npm --workspace @club/mobile run dev`

## Current Priorities

1. Keep the repo aligned to the club content workflow
2. Maintain separation from the separate weather/TestFlight project
3. Improve the mobile submission flow, review flow, and publishing flow
