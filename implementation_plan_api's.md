# Job Search REST API Documentation

This document outlines the REST API endpoints used by the Angular frontend to hydrate the `search-job` component.

## Architecture

The Job Search component uses a two-step API flow to handle deeply nested hierarchies efficiently. 

1. **1st API Call (`/hierarchy`)**: Fetches the top-level categories and an initial list of default values.
2. **2nd API Call (`/jobs`)**: Fetches specific filtered results within a category using `fuse.js` fuzzy matching.

---

## 1. Get Job Hierarchy (1st API Call)

Returns the initial metadata hierarchy for the default view. It includes the top 5-6 initial titles and their total record counts for each category.

**Endpoint:** `GET /api/v1/jobs/hierarchy`

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `surveyCode` | string | Yes | The survey context (e.g., `SURV-2024`) |

### Example Request
```http
GET /api/v1/jobs/hierarchy?surveyCode=SURV-2024
```

### Example Response
```json
{
  "categories": [
    {
      "name": "Job Family",
      "initialTitles": [
        { "title": "Administration, Facilities & Secretarial", "records": 450 },
        { "title": "Engineering & Science", "records": 820 }
      ]
    },
    {
      "name": "Specialization",
      "initialTitles": [
        { "title": "Application Development & Maintenance", "records": 120 },
        { "title": "Backend Systems Engineering", "records": 90 }
      ]
    }
  ]
}
```

---

## 2. Fuzzy Search Jobs (2nd API Call)

Runs a `fuse.js` fuzzy search against the job titles within a specific category.

**Endpoint:** `GET /api/v1/jobs`

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `surveyCode` | string | Yes | The survey context (e.g., `SURV-2024`) |
| `title` | string | Yes | The active hierarchy category (e.g., `Specialization`, `Job Family`) |
| `q` | string | Optional | The search term input by the user (e.g., `DevOps`) |

### Example Request
```http
GET /api/v1/jobs?surveyCode=SURV-2024&title=Specialization&q=DevOps
```

### Example Response
```json
{
  "totalRecords": 140,
  "query": "DevOps",
  "results": [
    { "title": "IT Software Development & Operations (DevOps)", "records": 50 },
    { "title": "Application Development & Maintenance", "records": 140 }
  ]
}
```

---

## UI Component Behavior
1. **Initial Load**: The UI calls `/hierarchy` and renders the list of `categories`.
2. **Category Selection**: The user clicks a category (e.g., "Specialization"). The UI dynamically updates the view to show the `initialTitles` for that category as radio buttons.
3. **Searching**: If the user types in the search bar, the UI debounces for 300ms and calls the `/jobs` endpoint, passing the typed string as `q`, along with the `surveyCode` and `title`. The returned `results` replace the initial radio buttons.
