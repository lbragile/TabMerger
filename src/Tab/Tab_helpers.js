/* 
TabMerger as the name implies merges your tabs into one location to save
memory usage and increase your productivity.

Copyright (C) 2021  Lior Bragilevsky

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

If you have any questions, comments, or concerns you can contact the
TabMerger team at <https://tabmerger.herokuapp.com/contact/>
*/

/**
 * @module Tab/Tab_helpers
 */

/**
 * Used to retrieve FavIconURL from a given domain
 * @param {string} url Full URL of the tab for which the FavIconURL is required
 * @return {string} The tab's FavIconURL in the form of a google API call.
 *
 * @note Only the domain of a given URL is used, not the full URL.
 */
export function getFavIconURL(url) {
  // domain will be null if no match is found
  var matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
  var domain = matches && matches[1];

  return 'http://www.google.com/s2/favicons?domain=' + domain;
}
