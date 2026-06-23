# Implementing Autocomplete & Fuzzy Search in MongoDB Atlas

To implement incredibly fast, typo-tolerant autocomplete for your hierarchical job collection, you will use **MongoDB Atlas Search**. Atlas Search is powered by Apache Lucene and is vastly superior to standard regex queries.

Here are the exact steps to configure it for your nested schema (`families` -> `subFamilies` -> `specializations`).

---

## Step 1: Create the Search Index in Atlas UI

First, we need to create a specialized index that uses `edgeGram` tokenization. This breaks down words (like `"Development"`) into chunks (`"De"`, `"Dev"`, `"Deve"`) so the database can match them instantly as the user types.

1. Log into your **MongoDB Atlas Dashboard**.
2. Navigate to your cluster and click the **Search** tab.
3. Click **Create Search Index**.
4. Choose **JSON Editor** and click Next.
5. Select the database and collection where your survey hierarchy data is stored.
6. Name the index `job_autocomplete` (or similar).
7. Paste the following configuration into the JSON editor:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "families": {
        "type": "document",
        "fields": {
          "subFamilies": {
            "type": "document",
            "fields": {
              "specializations": {
                "type": "document",
                "fields": {
                  "name": {
                    "type": "autocomplete",
                    "analyzer": "lucene.standard",
                    "tokenization": "edgeGram",
                    "minGrams": 2,
                    "maxGrams": 15,
                    "foldDiacritics": true
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```
8. Click **Save** and wait a few minutes for the index status to change to "Active".

---

## Step 2: Querying the Index in Node.js

Once the index is built, you will update your API endpoint to use the `$search` aggregation pipeline operator.

Because your data is deeply nested, the `$search` operator will find the *entire parent document* that contains the matching specialization. You will then need to `$unwind` the arrays and filter down to just the specific specializations that matched.

Here is the aggregation pipeline you will execute when the UI calls the 2nd API with a query (`?q=Dev`):

```javascript
const query = req.query.q; // e.g., "DevOps"

const pipeline = [
  // 1. Perform the fuzzy autocomplete search using Lucene
  {
    $search: {
      index: "job_autocomplete", // The exact name you gave the index in Step 1
      autocomplete: {
        query: query,
        path: "families.subFamilies.specializations.name",
        fuzzy: {
          maxEdits: 1,      // Allows 1 typo (e.g., "DevOpss" matches "DevOps")
          prefixLength: 2   // Requires the first 2 characters to be exact for performance
        }
      }
    }
  },
  // 2. Unwind the deeply nested arrays to flatten the data
  { $unwind: "$families" },
  { $unwind: "$families.subFamilies" },
  { $unwind: "$families.subFamilies.specializations" },
  // 3. Filter the unwound documents to keep ONLY the specializations that actually match the search term
  // (Since $search returns the whole document, we have to filter out sibling specializations that didn't match)
  {
    $match: {
      "families.subFamilies.specializations.name": {
        $regex: new RegExp(query, "i") // Case-insensitive filter on the flattened results
      }
    }
  },
  // 4. Project (Format) the final output exactly how the UI expects it
  {
    $project: {
      _id: 0,
      title: "$families.subFamilies.specializations.name",
      records: "$families.subFamilies.specializations.sampleSize.incs",
      id: "$families.subFamilies.specializations.id"
    }
  },
  // 5. Limit the results so the UI dropdown doesn't crash
  { $limit: 20 }
];

// Execute the query
const results = await db.collection('your_collection_name').aggregate(pipeline).toArray();

// Count the total records aggregated
const totalRecords = results.reduce((acc, curr) => acc + (curr.records || 0), 0);

res.json({
  totalRecords,
  query,
  results
});
```

### Why this pipeline is extremely powerful:
1. The initial `$search` stage uses the Lucene index, which operates in milliseconds.
2. We allow `maxEdits: 1`, meaning if a user types `"Enginer"`, it will correctly find `"Engineer"`.
3. We flatten and aggregate the results so the Angular UI receives a simple, flat array of matching options perfectly formatted for the radio buttons.
