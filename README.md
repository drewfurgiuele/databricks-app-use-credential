# databricks-app-use-credential

A quick example of how to get and use a Databricks Unity Catalog service credential and then generate an Entra token for a specific audience.

Before deploying, in the app.yaml:
 
 1. Set `UC_CREDENTIAL_NAME` to the name of your service credential
 2. Set `UC_AZURE_RESOURCES` for the audience of the token you want to generate
 3. Make sure your app's service principal has `ACCESS` permissions to the credential