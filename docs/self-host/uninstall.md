# Uninstall

Removing an instance touches three places: GitHub, the host, and each repository the App pushed images to. Work in this order, because step 2 needs the instance running.

1. **Take a last backup** if you may want the data again ([Back up and restore](./backup-restore.md)). After step 6 nothing brings it back.
2. **Delete the attachment branches.** Each repository where a reviewer attached an image holds a `mergebrief/attachments` branch the App pushed ([attachments.md](./attachments.md)), and uninstalling the App leaves it in place. While the instance runs, a repository admin deletes it from Home: the row menu of any pull request in that repository offers **Delete attachment branch**. Once the App is gone, or for a repository Home does not list, delete it on GitHub. To find the branches across an account or organization:

   ```sh
   for repo in $(gh repo list <owner> --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner'); do
     gh api "repos/$repo/git/ref/heads/mergebrief/attachments" --silent 2>/dev/null && echo "$repo"
   done
   ```

   and delete one with:

   ```sh
   gh api -X DELETE "repos/<owner>/<repo>/git/refs/heads/mergebrief/attachments"
   ```

   Every comment that embedded an image from the branch, on GitHub included, then shows a broken image.

3. **Uninstall the App from each account and organization** that installed it: in that account's or organization's settings, open the App under its installed GitHub Apps, choose **Configure**, then **Uninstall**. A running instance receives the uninstall and deletes that installation's pull requests and briefs at once. The App's Entry comments stay on GitHub; delete them there if you want them gone.
4. **Delete the App registration:** on the App's settings page, **Advanced**, then **Delete GitHub App**.
5. **Revoke the URL fallback token**, if you set `MERGEBRIEF_URL_FALLBACK_TOKEN`: delete it on GitHub under **Settings**, **Developer settings**, **Personal access tokens**, on the account that owns it.
6. **Remove the containers, then the data.** First turn off the units you set up, so a reboot does not start an empty stack: `sudo systemctl disable --now mergebrief` for [start on boot](./compose.md#start-on-boot), and `sudo systemctl disable --now mergebrief-backup.timer` for [scheduled backups](./backup-restore.md#schedule-backups). Then, from the folder that holds `docker-compose.yml`:

   > [!WARNING]
   > `--volumes` deletes the `postgres_data` volume, and with it every brief, review session, API token and audit row. Only a dump from step 1 brings it back.

   ```sh
   docker compose down --volumes --rmi all
   ```

   On an external database, drop the database through your provider instead; `--volumes` has nothing to remove there.

7. **Delete the host files:** `.env`, `mergebrief.config.yaml`, any private key file, `docker-compose.override.yml` and the `secrets/` folder, which holds the database URL with its password when you use `DATABASE_URL_FILE`. On an external database, also drop or rotate the role the instance used.

Treat old dumps like `.env`: a dump holds every user's encrypted GitHub tokens, and `.env` holds the key that opens them.

**Check:** `docker volume ls --filter name=postgres_data` lists nothing, and `https://github.com/apps/<your-app-slug>` answers 404.

A user leaving a running instance can clear their own side without waiting for you: [If an account or token leaks](./security-model.md#if-an-account-or-token-leaks) lists the three steps.
